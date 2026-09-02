use std::collections::{BTreeMap, BTreeSet};

use echo_town_protocol::{
    ActorState, ArtifactEffectPayload, ArtifactEffectRule, ArtifactExperimentEnvelope,
    ClaimShareEnvelope, ClaimSharePayload, IntentEnvelope, MAX_INTENT_BUDGET, PROTOCOL_VERSION,
    WorldEvent, WorldEventPayload,
};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use wasm_bindgen::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldState {
    pub schema_version: u16,
    pub world_id: String,
    pub zone_id: String,
    pub epoch: u64,
    pub logical_time: u64,
    pub authority_id: String,
    pub mystery_rules_hash: String,
    pub event_log_hash: String,
    pub actors: BTreeMap<String, ActorState>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RejectReason {
    SchemaVersion,
    World,
    Zone,
    UnknownActor,
    PublicKey,
    Sequence,
    ObservedState,
    Budget,
    LogicalTime,
    IntentType,
    MovementRange,
    Signature,
    Encoding,
    Artifact,
    Action,
    SourceEvent,
    SourceVisibility,
    FragmentSource,
    Witness,
    Visibility,
    WitnessSignature,
    Claim,
    Audience,
}

impl RejectReason {
    pub fn code(&self) -> &'static str {
        match self {
            Self::SchemaVersion => "schema_version",
            Self::World => "world",
            Self::Zone => "zone",
            Self::UnknownActor => "unknown_actor",
            Self::PublicKey => "public_key",
            Self::Sequence => "sequence",
            Self::ObservedState => "observed_state",
            Self::Budget => "budget",
            Self::LogicalTime => "logical_time",
            Self::IntentType => "intent_type",
            Self::MovementRange => "movement_range",
            Self::Signature => "signature",
            Self::Encoding => "encoding",
            Self::Artifact => "artifact",
            Self::Action => "action",
            Self::SourceEvent => "source_event",
            Self::SourceVisibility => "source_visibility",
            Self::FragmentSource => "fragment_source",
            Self::Witness => "witness",
            Self::Visibility => "visibility",
            Self::WitnessSignature => "witness_signature",
            Self::Claim => "claim",
            Self::Audience => "audience",
        }
    }
}

pub struct WorldCore {
    state: WorldState,
    actor_public_keys: BTreeMap<String, String>,
    events: Vec<WorldEvent>,
    artifact_rules: Vec<ArtifactEffectRule>,
    accepted_source_event_ids: BTreeSet<String>,
    fragment_sources: BTreeMap<String, String>,
    active_world_signals: BTreeSet<String>,
    actor_observed_fragments: BTreeMap<String, BTreeSet<String>>,
    actor_known_source_event_ids: BTreeMap<String, BTreeSet<String>>,
}

impl WorldCore {
    pub fn new(
        world_id: impl Into<String>,
        zone_id: impl Into<String>,
        authority_id: impl Into<String>,
        actors: Vec<(String, String, ActorState)>,
    ) -> Self {
        let mut actor_states = BTreeMap::new();
        let mut actor_public_keys = BTreeMap::new();
        for (actor_id, public_key, state) in actors {
            actor_public_keys.insert(actor_id.clone(), public_key);
            actor_states.insert(actor_id, state);
        }
        Self {
            state: WorldState {
                schema_version: PROTOCOL_VERSION,
                world_id: world_id.into(),
                zone_id: zone_id.into(),
                epoch: 1,
                logical_time: 0,
                authority_id: authority_id.into(),
                mystery_rules_hash: hex::encode(Sha256::digest(b"echo-town-no-mystery-rules-v1")),
                event_log_hash: hex::encode(Sha256::digest(b"echo-town-empty-event-log-v1")),
                actors: actor_states,
            },
            actor_public_keys,
            events: Vec::new(),
            artifact_rules: Vec::new(),
            accepted_source_event_ids: BTreeSet::new(),
            fragment_sources: BTreeMap::new(),
            active_world_signals: BTreeSet::new(),
            actor_observed_fragments: BTreeMap::new(),
            actor_known_source_event_ids: BTreeMap::new(),
        }
    }

    pub fn with_artifact_rules(
        mut self,
        mut artifact_rules: Vec<ArtifactEffectRule>,
        accepted_source_event_ids: Vec<String>,
        fragment_sources: BTreeMap<String, String>,
        active_world_signals: Vec<String>,
        actor_observed_fragments: BTreeMap<String, Vec<String>>,
    ) -> Self {
        artifact_rules.sort_by(|left, right| {
            (&left.artifact_id, &left.effect_id).cmp(&(&right.artifact_id, &right.effect_id))
        });
        self.artifact_rules = if valid_artifact_rules(&artifact_rules) {
            artifact_rules
        } else {
            Vec::new()
        };
        self.accepted_source_event_ids = accepted_source_event_ids.into_iter().collect();
        self.fragment_sources = fragment_sources;
        self.active_world_signals = active_world_signals.into_iter().collect();
        self.actor_observed_fragments = actor_observed_fragments
            .into_iter()
            .map(|(actor_id, fragments)| (actor_id, fragments.into_iter().collect()))
            .collect();
        self.actor_known_source_event_ids = self
            .state
            .actors
            .keys()
            .map(|actor_id| {
                let known_sources = self
                    .actor_observed_fragments
                    .get(actor_id)
                    .into_iter()
                    .flatten()
                    .filter_map(|fragment_id| self.fragment_sources.get(fragment_id).cloned())
                    .collect();
                (actor_id.clone(), known_sources)
            })
            .collect();
        let rules_bytes = serde_json::to_vec(&(
            &self.artifact_rules,
            &self.accepted_source_event_ids,
            &self.fragment_sources,
            &self.active_world_signals,
            &self.actor_observed_fragments,
        ))
        .expect("mystery rules are serializable");
        self.state.mystery_rules_hash = hex::encode(Sha256::digest(rules_bytes));
        self
    }

    pub fn state(&self) -> &WorldState {
        &self.state
    }

    pub fn events(&self) -> &[WorldEvent] {
        &self.events
    }

    pub fn state_hash(&self) -> String {
        state_hash(&self.state)
    }

    pub fn apply_intent(&mut self, intent: &IntentEnvelope) -> Result<WorldEvent, RejectReason> {
        self.validate(intent)?;
        let previous_state_hash = self.state_hash();
        let accepted_intent_hash = hex::encode(Sha256::digest(
            intent.signing_bytes().map_err(|_| RejectReason::Encoding)?,
        ));
        let actor = self
            .state
            .actors
            .get_mut(&intent.actor_id)
            .expect("validated actor");
        actor.x += i32::from(intent.payload.dx);
        actor.y += i32::from(intent.payload.dy);
        actor.last_seq = intent.seq;
        self.state.logical_time += 1;
        self.advance_event_log(&accepted_intent_hash);
        let next_state_hash = self.state_hash();
        let event = WorldEvent {
            schema_version: PROTOCOL_VERSION,
            world_id: self.state.world_id.clone(),
            zone_id: self.state.zone_id.clone(),
            epoch: self.state.epoch,
            event_seq: self.events.len() as u64 + 1,
            previous_state_hash,
            accepted_intent_hash: accepted_intent_hash.clone(),
            event_type: "ActorMoved".to_owned(),
            actor_id: intent.actor_id.clone(),
            payload: WorldEventPayload::Movement(intent.payload.clone()),
            next_state_hash,
            authority_id: self.state.authority_id.clone(),
        };
        self.events.push(event.clone());
        self.accepted_source_event_ids
            .insert(accepted_intent_hash.clone());
        self.remember_sources(&intent.actor_id, [accepted_intent_hash]);
        Ok(event)
    }

    pub fn apply_artifact_experiment(
        &mut self,
        intent: &ArtifactExperimentEnvelope,
    ) -> Result<WorldEvent, RejectReason> {
        self.validate_artifact_experiment(intent)?;
        let previous_state_hash = self.state_hash();
        let accepted_intent_hash = hex::encode(Sha256::digest(
            intent.signing_bytes().map_err(|_| RejectReason::Encoding)?,
        ));
        let actor = self
            .state
            .actors
            .get_mut(&intent.actor_id)
            .expect("validated actor");
        actor.last_seq = intent.seq;
        self.state.logical_time += 1;
        self.advance_event_log(&accepted_intent_hash);
        let matched = self.artifact_rules.iter().find(|rule| {
            rule.artifact_id == intent.artifact_id
                && rule.accepted_actions.contains(&intent.action)
                && rule
                    .required_fragment_ids
                    .iter()
                    .all(|fragment| intent.observed_fragment_ids.contains(fragment))
                && rule
                    .required_world_signals
                    .iter()
                    .all(|signal| self.active_world_signals.contains(signal))
                && intent.witness_actor_ids.len() >= usize::from(rule.minimum_witnesses)
        });
        let effect_id = matched.map(|rule| rule.effect_id.clone());
        let effect_kind = matched.map(|rule| rule.effect_kind.clone());
        let magnitude = matched.map(|rule| rule.magnitude);
        let duration_ticks = matched.map(|rule| rule.duration_ticks);
        let feedback_class = matched
            .map(|rule| rule.feedback_class.clone())
            .unwrap_or_else(|| "faint".to_owned());
        let next_state_hash = self.state_hash();
        let event = WorldEvent {
            schema_version: PROTOCOL_VERSION,
            world_id: self.state.world_id.clone(),
            zone_id: self.state.zone_id.clone(),
            epoch: self.state.epoch,
            event_seq: self.events.len() as u64 + 1,
            previous_state_hash,
            accepted_intent_hash: accepted_intent_hash.clone(),
            event_type: if effect_id.is_some() {
                "ArtifactEffectObserved".to_owned()
            } else {
                "ArtifactExperimentFeedback".to_owned()
            },
            actor_id: intent.actor_id.clone(),
            payload: WorldEventPayload::ArtifactEffect(ArtifactEffectPayload {
                artifact_id: intent.artifact_id.clone(),
                action: intent.action.clone(),
                source_event_ids: intent.source_event_ids.clone(),
                effect_id,
                effect_kind,
                magnitude,
                duration_ticks,
                feedback_class,
            }),
            next_state_hash,
            authority_id: self.state.authority_id.clone(),
        };
        self.events.push(event.clone());
        self.accepted_source_event_ids
            .insert(accepted_intent_hash.clone());
        for actor_id in &intent.witness_actor_ids {
            self.remember_sources(actor_id, [accepted_intent_hash.clone()]);
        }
        Ok(event)
    }

    pub fn apply_claim_share(
        &mut self,
        intent: &ClaimShareEnvelope,
    ) -> Result<WorldEvent, RejectReason> {
        self.validate_claim_share(intent)?;
        let previous_state_hash = self.state_hash();
        let accepted_intent_hash = hex::encode(Sha256::digest(
            intent.signing_bytes().map_err(|_| RejectReason::Encoding)?,
        ));
        let actor = self
            .state
            .actors
            .get_mut(&intent.actor_id)
            .expect("validated actor");
        actor.last_seq = intent.seq;
        self.state.logical_time += 1;
        self.advance_event_log(&accepted_intent_hash);
        let next_state_hash = self.state_hash();
        let event = WorldEvent {
            schema_version: PROTOCOL_VERSION,
            world_id: self.state.world_id.clone(),
            zone_id: self.state.zone_id.clone(),
            epoch: self.state.epoch,
            event_seq: self.events.len() as u64 + 1,
            previous_state_hash,
            accepted_intent_hash: accepted_intent_hash.clone(),
            event_type: "ClaimShared".to_owned(),
            actor_id: intent.actor_id.clone(),
            payload: WorldEventPayload::ClaimShare(ClaimSharePayload {
                claim_id: intent.claim_id.clone(),
                source_event_ids: intent.source_event_ids.clone(),
                audience_actor_ids: intent.audience_actor_ids.clone(),
                proposition_hash: intent.proposition_hash.clone(),
            }),
            next_state_hash,
            authority_id: self.state.authority_id.clone(),
        };
        self.events.push(event.clone());
        self.accepted_source_event_ids
            .insert(accepted_intent_hash.clone());
        self.remember_sources(&intent.actor_id, [accepted_intent_hash.clone()]);
        for actor_id in &intent.audience_actor_ids {
            self.remember_sources(
                actor_id,
                intent
                    .source_event_ids
                    .iter()
                    .cloned()
                    .chain([accepted_intent_hash.clone()]),
            );
        }
        Ok(event)
    }

    fn remember_sources(
        &mut self,
        actor_id: &str,
        source_event_ids: impl IntoIterator<Item = String>,
    ) {
        self.actor_known_source_event_ids
            .entry(actor_id.to_owned())
            .or_default()
            .extend(source_event_ids);
    }

    fn advance_event_log(&mut self, accepted_intent_hash: &str) {
        self.state.event_log_hash = hex::encode(Sha256::digest(format!(
            "{}:{}",
            self.state.event_log_hash, accepted_intent_hash
        )));
    }

    pub fn replay<'a>(
        &mut self,
        intents: impl IntoIterator<Item = &'a IntentEnvelope>,
    ) -> Result<Vec<WorldEvent>, RejectReason> {
        intents
            .into_iter()
            .map(|intent| self.apply_intent(intent))
            .collect()
    }

    fn validate(&self, intent: &IntentEnvelope) -> Result<(), RejectReason> {
        if intent.schema_version != PROTOCOL_VERSION {
            return Err(RejectReason::SchemaVersion);
        }
        if intent.world_id != self.state.world_id {
            return Err(RejectReason::World);
        }
        if intent.zone_id != self.state.zone_id {
            return Err(RejectReason::Zone);
        }
        let actor = self
            .state
            .actors
            .get(&intent.actor_id)
            .ok_or(RejectReason::UnknownActor)?;
        let expected_key = self
            .actor_public_keys
            .get(&intent.actor_id)
            .ok_or(RejectReason::UnknownActor)?;
        if &intent.public_key_hex != expected_key {
            return Err(RejectReason::PublicKey);
        }
        if intent.seq != actor.last_seq + 1 {
            return Err(RejectReason::Sequence);
        }
        if intent.observed_state_hash != self.state_hash() {
            return Err(RejectReason::ObservedState);
        }
        if intent.budget == 0 || intent.budget > MAX_INTENT_BUDGET {
            return Err(RejectReason::Budget);
        }
        if intent.created_at_logical < self.state.logical_time {
            return Err(RejectReason::LogicalTime);
        }
        if intent.intent_type != "move" {
            return Err(RejectReason::IntentType);
        }
        if intent.payload.dx.abs() > 1 || intent.payload.dy.abs() > 1 {
            return Err(RejectReason::MovementRange);
        }
        verify_signature(intent)
    }

    fn validate_artifact_experiment(
        &self,
        intent: &ArtifactExperimentEnvelope,
    ) -> Result<(), RejectReason> {
        if intent.schema_version != PROTOCOL_VERSION {
            return Err(RejectReason::SchemaVersion);
        }
        if intent.world_id != self.state.world_id {
            return Err(RejectReason::World);
        }
        if intent.zone_id != self.state.zone_id {
            return Err(RejectReason::Zone);
        }
        let actor = self
            .state
            .actors
            .get(&intent.actor_id)
            .ok_or(RejectReason::UnknownActor)?;
        let expected_key = self
            .actor_public_keys
            .get(&intent.actor_id)
            .ok_or(RejectReason::UnknownActor)?;
        if &intent.public_key_hex != expected_key {
            return Err(RejectReason::PublicKey);
        }
        if intent.seq != actor.last_seq + 1 {
            return Err(RejectReason::Sequence);
        }
        if intent.observed_state_hash != self.state_hash() {
            return Err(RejectReason::ObservedState);
        }
        if intent.budget == 0 || intent.budget > MAX_INTENT_BUDGET {
            return Err(RejectReason::Budget);
        }
        if intent.created_at_logical < self.state.logical_time {
            return Err(RejectReason::LogicalTime);
        }
        let artifact_rules: Vec<_> = self
            .artifact_rules
            .iter()
            .filter(|rule| rule.artifact_id == intent.artifact_id)
            .collect();
        if artifact_rules.is_empty() {
            return Err(RejectReason::Artifact);
        }
        if !artifact_rules
            .iter()
            .any(|rule| rule.accepted_actions.contains(&intent.action))
        {
            return Err(RejectReason::Action);
        }
        if intent.source_event_ids.is_empty()
            || intent
                .source_event_ids
                .iter()
                .any(|event| !self.accepted_source_event_ids.contains(event))
        {
            return Err(RejectReason::SourceEvent);
        }
        if self
            .actor_known_source_event_ids
            .get(&intent.actor_id)
            .is_none_or(|known| {
                intent
                    .source_event_ids
                    .iter()
                    .any(|event| !known.contains(event))
            })
        {
            return Err(RejectReason::SourceVisibility);
        }
        if intent.observed_fragment_ids.is_empty()
            || intent.observed_fragment_ids.iter().any(|fragment| {
                self.fragment_sources
                    .get(fragment)
                    .is_none_or(|event| !intent.source_event_ids.contains(event))
            })
        {
            return Err(RejectReason::FragmentSource);
        }
        if self
            .actor_observed_fragments
            .get(&intent.actor_id)
            .is_none_or(|visible| {
                intent
                    .observed_fragment_ids
                    .iter()
                    .any(|fragment| !visible.contains(fragment))
            })
        {
            return Err(RejectReason::Visibility);
        }
        let witnesses: BTreeSet<_> = intent.witness_actor_ids.iter().collect();
        let actor_position = (actor.x, actor.y);
        if witnesses.len() != intent.witness_actor_ids.len()
            || !witnesses.contains(&intent.actor_id)
            || witnesses.iter().any(|actor_id| {
                self.state.actors.get(*actor_id).is_none_or(|witness| {
                    (witness.x - actor_position.0).abs() > 1
                        || (witness.y - actor_position.1).abs() > 1
                })
            })
        {
            return Err(RejectReason::Witness);
        }
        let required_attestations: BTreeSet<_> = witnesses
            .iter()
            .filter(|actor_id| actor_id.as_str() != intent.actor_id)
            .copied()
            .collect();
        let provided_attestations: BTreeSet<_> = intent
            .witness_attestations
            .iter()
            .map(|attestation| &attestation.actor_id)
            .collect();
        if required_attestations != provided_attestations
            || provided_attestations.len() != intent.witness_attestations.len()
            || intent.witness_attestations.iter().any(|attestation| {
                self.actor_public_keys
                    .get(&attestation.actor_id)
                    .is_none_or(|expected| expected != &attestation.public_key_hex)
                    || verify_detached_signature(
                        &attestation.public_key_hex,
                        &attestation.signature_hex,
                        intent.witness_signing_bytes(&attestation.actor_id),
                    )
                    .is_err()
            })
        {
            return Err(RejectReason::WitnessSignature);
        }
        verify_artifact_signature(intent)
    }

    fn validate_claim_share(&self, intent: &ClaimShareEnvelope) -> Result<(), RejectReason> {
        if intent.schema_version != PROTOCOL_VERSION {
            return Err(RejectReason::SchemaVersion);
        }
        if intent.world_id != self.state.world_id {
            return Err(RejectReason::World);
        }
        if intent.zone_id != self.state.zone_id {
            return Err(RejectReason::Zone);
        }
        let actor = self
            .state
            .actors
            .get(&intent.actor_id)
            .ok_or(RejectReason::UnknownActor)?;
        let expected_key = self
            .actor_public_keys
            .get(&intent.actor_id)
            .ok_or(RejectReason::UnknownActor)?;
        if &intent.public_key_hex != expected_key {
            return Err(RejectReason::PublicKey);
        }
        if intent.seq != actor.last_seq + 1 {
            return Err(RejectReason::Sequence);
        }
        if intent.observed_state_hash != self.state_hash() {
            return Err(RejectReason::ObservedState);
        }
        if intent.budget == 0 || intent.budget > MAX_INTENT_BUDGET {
            return Err(RejectReason::Budget);
        }
        if intent.created_at_logical < self.state.logical_time {
            return Err(RejectReason::LogicalTime);
        }
        if intent.claim_id.is_empty()
            || intent.claim_id.len() > 96
            || intent.proposition_hash.len() != 64
            || hex::decode(&intent.proposition_hash).is_err()
        {
            return Err(RejectReason::Claim);
        }
        if intent.source_event_ids.is_empty()
            || intent
                .source_event_ids
                .iter()
                .any(|event| !self.accepted_source_event_ids.contains(event))
        {
            return Err(RejectReason::SourceEvent);
        }
        if self
            .actor_known_source_event_ids
            .get(&intent.actor_id)
            .is_none_or(|known| {
                intent
                    .source_event_ids
                    .iter()
                    .any(|event| !known.contains(event))
            })
        {
            return Err(RejectReason::SourceVisibility);
        }
        let audiences: BTreeSet<_> = intent.audience_actor_ids.iter().collect();
        if audiences.is_empty()
            || audiences.len() != intent.audience_actor_ids.len()
            || audiences.contains(&intent.actor_id)
            || audiences
                .iter()
                .any(|actor_id| !self.state.actors.contains_key(*actor_id))
        {
            return Err(RejectReason::Audience);
        }
        verify_claim_share_signature(intent)
    }
}

fn valid_artifact_rules(rules: &[ArtifactEffectRule]) -> bool {
    if rules.is_empty() {
        return true;
    }
    let mut actions = BTreeSet::new();
    let mut effects = BTreeSet::new();
    rules.iter().all(|rule| {
        !rule.artifact_id.is_empty()
            && !rule.effect_id.is_empty()
            && effects.insert((&rule.artifact_id, &rule.effect_id))
            && !rule.accepted_actions.is_empty()
            && rule
                .accepted_actions
                .iter()
                .all(|action| !action.is_empty() && actions.insert((&rule.artifact_id, action)))
            && !rule.required_fragment_ids.is_empty()
            && rule.minimum_witnesses > 0
            && rule.minimum_witnesses <= 12
            && matches!(
                rule.effect_kind.as_str(),
                "observation_pulse" | "artifact_resonance" | "resource_pulse"
            )
            && (1..=100).contains(&rule.magnitude)
            && (1..=240).contains(&rule.duration_ticks)
            && matches!(
                rule.feedback_class.as_str(),
                "faint" | "ambiguous" | "resonant"
            )
    })
}

fn verify_signature(intent: &IntentEnvelope) -> Result<(), RejectReason> {
    let public_key_bytes =
        hex::decode(&intent.public_key_hex).map_err(|_| RejectReason::PublicKey)?;
    let public_key_array: [u8; 32] = public_key_bytes
        .try_into()
        .map_err(|_| RejectReason::PublicKey)?;
    let verifying_key =
        VerifyingKey::from_bytes(&public_key_array).map_err(|_| RejectReason::PublicKey)?;
    let signature_bytes =
        hex::decode(&intent.signature_hex).map_err(|_| RejectReason::Signature)?;
    let signature = Signature::from_slice(&signature_bytes).map_err(|_| RejectReason::Signature)?;
    let message = intent.signing_bytes().map_err(|_| RejectReason::Encoding)?;
    verifying_key
        .verify(&message, &signature)
        .map_err(|_| RejectReason::Signature)
}

fn verify_artifact_signature(intent: &ArtifactExperimentEnvelope) -> Result<(), RejectReason> {
    let public_key_bytes =
        hex::decode(&intent.public_key_hex).map_err(|_| RejectReason::PublicKey)?;
    let public_key_array: [u8; 32] = public_key_bytes
        .try_into()
        .map_err(|_| RejectReason::PublicKey)?;
    let verifying_key =
        VerifyingKey::from_bytes(&public_key_array).map_err(|_| RejectReason::PublicKey)?;
    let signature_bytes =
        hex::decode(&intent.signature_hex).map_err(|_| RejectReason::Signature)?;
    let signature = Signature::from_slice(&signature_bytes).map_err(|_| RejectReason::Signature)?;
    let message = intent.signing_bytes().map_err(|_| RejectReason::Encoding)?;
    verifying_key
        .verify(&message, &signature)
        .map_err(|_| RejectReason::Signature)
}

fn verify_claim_share_signature(intent: &ClaimShareEnvelope) -> Result<(), RejectReason> {
    verify_detached_signature(
        &intent.public_key_hex,
        &intent.signature_hex,
        intent.signing_bytes(),
    )
}

fn verify_detached_signature(
    public_key_hex: &str,
    signature_hex: &str,
    message: Result<Vec<u8>, serde_json::Error>,
) -> Result<(), RejectReason> {
    let public_key_bytes = hex::decode(public_key_hex).map_err(|_| RejectReason::PublicKey)?;
    let public_key_array: [u8; 32] = public_key_bytes
        .try_into()
        .map_err(|_| RejectReason::PublicKey)?;
    let verifying_key =
        VerifyingKey::from_bytes(&public_key_array).map_err(|_| RejectReason::PublicKey)?;
    let signature_bytes = hex::decode(signature_hex).map_err(|_| RejectReason::Signature)?;
    let signature = Signature::from_slice(&signature_bytes).map_err(|_| RejectReason::Signature)?;
    verifying_key
        .verify(&message.map_err(|_| RejectReason::Encoding)?, &signature)
        .map_err(|_| RejectReason::Signature)
}

fn state_hash(state: &WorldState) -> String {
    let bytes = serde_json::to_vec(state).expect("WorldState is serializable");
    hex::encode(Sha256::digest(bytes))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WasmConfig {
    world_id: String,
    zone_id: String,
    authority_id: String,
    actors: Vec<WasmActor>,
    #[serde(default)]
    artifact_rules: Vec<ArtifactEffectRule>,
    #[serde(default)]
    accepted_source_event_ids: Vec<String>,
    #[serde(default)]
    fragment_sources: BTreeMap<String, String>,
    #[serde(default)]
    active_world_signals: Vec<String>,
    #[serde(default)]
    actor_observed_fragments: BTreeMap<String, Vec<String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WasmActor {
    actor_id: String,
    public_key_hex: String,
    x: i32,
    y: i32,
}

#[wasm_bindgen]
pub struct WasmWorldCore {
    inner: WorldCore,
}

#[wasm_bindgen]
impl WasmWorldCore {
    #[wasm_bindgen(constructor)]
    pub fn new(config_json: &str) -> Result<WasmWorldCore, JsError> {
        let config: WasmConfig =
            serde_json::from_str(config_json).map_err(|error| JsError::new(&error.to_string()))?;
        let actors = config
            .actors
            .into_iter()
            .map(|actor| {
                (
                    actor.actor_id,
                    actor.public_key_hex,
                    ActorState {
                        x: actor.x,
                        y: actor.y,
                        last_seq: 0,
                    },
                )
            })
            .collect();
        Ok(Self {
            inner: WorldCore::new(config.world_id, config.zone_id, config.authority_id, actors)
                .with_artifact_rules(
                    config.artifact_rules,
                    config.accepted_source_event_ids,
                    config.fragment_sources,
                    config.active_world_signals,
                    config.actor_observed_fragments,
                ),
        })
    }

    #[wasm_bindgen]
    pub fn apply_intent(&mut self, intent_json: &str) -> Result<String, JsError> {
        let intent: IntentEnvelope =
            serde_json::from_str(intent_json).map_err(|error| JsError::new(&error.to_string()))?;
        let event = self
            .inner
            .apply_intent(&intent)
            .map_err(|reason| JsError::new(reason.code()))?;
        serde_json::to_string(&event).map_err(|error| JsError::new(&error.to_string()))
    }

    #[wasm_bindgen]
    pub fn apply_artifact_experiment(&mut self, intent_json: &str) -> Result<String, JsError> {
        let intent: ArtifactExperimentEnvelope =
            serde_json::from_str(intent_json).map_err(|error| JsError::new(&error.to_string()))?;
        let event = self
            .inner
            .apply_artifact_experiment(&intent)
            .map_err(|reason| JsError::new(reason.code()))?;
        serde_json::to_string(&event).map_err(|error| JsError::new(&error.to_string()))
    }

    #[wasm_bindgen]
    pub fn apply_claim_share(&mut self, intent_json: &str) -> Result<String, JsError> {
        let intent: ClaimShareEnvelope =
            serde_json::from_str(intent_json).map_err(|error| JsError::new(&error.to_string()))?;
        let event = self
            .inner
            .apply_claim_share(&intent)
            .map_err(|reason| JsError::new(reason.code()))?;
        serde_json::to_string(&event).map_err(|error| JsError::new(&error.to_string()))
    }

    #[wasm_bindgen]
    pub fn state_hash(&self) -> String {
        self.inner.state_hash()
    }

    #[wasm_bindgen]
    pub fn snapshot(&self) -> Result<String, JsError> {
        serde_json::to_string(self.inner.state()).map_err(|error| JsError::new(&error.to_string()))
    }
}

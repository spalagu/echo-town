use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u16 = 1;
pub const MAX_INTENT_BUDGET: u16 = 100;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntentPayload {
    pub dx: i16,
    pub dy: i16,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntentEnvelope {
    pub schema_version: u16,
    pub world_id: String,
    pub zone_id: String,
    pub actor_id: String,
    pub seq: u64,
    pub observed_state_hash: String,
    pub intent_type: String,
    pub payload: IntentPayload,
    pub budget: u16,
    pub created_at_logical: u64,
    pub model_class: String,
    pub public_key_hex: String,
    pub signature_hex: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SigningEnvelope<'a> {
    schema_version: u16,
    world_id: &'a str,
    zone_id: &'a str,
    actor_id: &'a str,
    seq: u64,
    observed_state_hash: &'a str,
    intent_type: &'a str,
    payload: &'a IntentPayload,
    budget: u16,
    created_at_logical: u64,
    model_class: &'a str,
    public_key_hex: &'a str,
}

impl IntentEnvelope {
    pub fn signing_bytes(&self) -> Result<Vec<u8>, serde_json::Error> {
        serde_json::to_vec(&SigningEnvelope {
            schema_version: self.schema_version,
            world_id: &self.world_id,
            zone_id: &self.zone_id,
            actor_id: &self.actor_id,
            seq: self.seq,
            observed_state_hash: &self.observed_state_hash,
            intent_type: &self.intent_type,
            payload: &self.payload,
            budget: self.budget,
            created_at_logical: self.created_at_logical,
            model_class: &self.model_class,
            public_key_hex: &self.public_key_hex,
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldEvent {
    pub schema_version: u16,
    pub world_id: String,
    pub zone_id: String,
    pub epoch: u64,
    pub event_seq: u64,
    pub previous_state_hash: String,
    pub accepted_intent_hash: String,
    pub event_type: String,
    pub actor_id: String,
    pub payload: WorldEventPayload,
    pub next_state_hash: String,
    pub authority_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum WorldEventPayload {
    Movement(IntentPayload),
    ArtifactEffect(ArtifactEffectPayload),
    ClaimShare(ClaimSharePayload),
    LatentZoneFactor(LatentZoneFactorPayload),
    ZoneReveal(ZoneRevealPayload),
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReachableEdge {
    pub from: String,
    pub to: String,
    pub bidirectional: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocationStateChange {
    pub location_id: String,
    pub state: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LatentZoneRule {
    pub alternative_id: String,
    pub phenomenon_id: String,
    pub zone_id: String,
    pub required_artifact_states: Vec<String>,
    pub required_world_predicates: Vec<String>,
    pub required_social_predicates: Vec<String>,
    pub required_action_sequence: Vec<String>,
    pub reveal_edges: Vec<ReachableEdge>,
    pub location_state_changes: Vec<LocationStateChange>,
    pub event_pool_adds: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LatentZoneFactorRule {
    pub trigger_id: String,
    pub phenomenon_id: String,
    pub factor_kind: String,
    pub factor_value: String,
    pub required_source_event_ids: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LatentZoneFactorPayload {
    pub phenomenon_id: String,
    pub trigger_id: String,
    pub source_event_ids: Vec<String>,
    pub feedback_class: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LatentZoneFactorEnvelope {
    pub schema_version: u16,
    pub world_id: String,
    pub zone_id: String,
    pub actor_id: String,
    pub seq: u64,
    pub observed_state_hash: String,
    pub phenomenon_id: String,
    pub trigger_id: String,
    pub source_event_ids: Vec<String>,
    pub budget: u16,
    pub created_at_logical: u64,
    pub public_key_hex: String,
    pub signature_hex: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LatentZoneFactorSigningEnvelope<'a> {
    schema_version: u16,
    world_id: &'a str,
    zone_id: &'a str,
    actor_id: &'a str,
    seq: u64,
    observed_state_hash: &'a str,
    phenomenon_id: &'a str,
    trigger_id: &'a str,
    source_event_ids: &'a [String],
    budget: u16,
    created_at_logical: u64,
    public_key_hex: &'a str,
}

impl LatentZoneFactorEnvelope {
    pub fn signing_bytes(&self) -> Result<Vec<u8>, serde_json::Error> {
        serde_json::to_vec(&LatentZoneFactorSigningEnvelope {
            schema_version: self.schema_version,
            world_id: &self.world_id,
            zone_id: &self.zone_id,
            actor_id: &self.actor_id,
            seq: self.seq,
            observed_state_hash: &self.observed_state_hash,
            phenomenon_id: &self.phenomenon_id,
            trigger_id: &self.trigger_id,
            source_event_ids: &self.source_event_ids,
            budget: self.budget,
            created_at_logical: self.created_at_logical,
            public_key_hex: &self.public_key_hex,
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoneRevealPayload {
    pub phenomenon_id: String,
    pub zone_id: Option<String>,
    pub source_event_ids: Vec<String>,
    pub reveal_edges: Vec<ReachableEdge>,
    pub location_state_changes: Vec<LocationStateChange>,
    pub event_pool_adds: Vec<String>,
    pub feedback_class: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LatentZoneAttemptEnvelope {
    pub schema_version: u16,
    pub world_id: String,
    pub zone_id: String,
    pub actor_id: String,
    pub seq: u64,
    pub observed_state_hash: String,
    pub phenomenon_id: String,
    pub source_event_ids: Vec<String>,
    pub budget: u16,
    pub created_at_logical: u64,
    pub public_key_hex: String,
    pub signature_hex: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LatentZoneAttemptSigningEnvelope<'a> {
    schema_version: u16,
    world_id: &'a str,
    zone_id: &'a str,
    actor_id: &'a str,
    seq: u64,
    observed_state_hash: &'a str,
    phenomenon_id: &'a str,
    source_event_ids: &'a [String],
    budget: u16,
    created_at_logical: u64,
    public_key_hex: &'a str,
}

impl LatentZoneAttemptEnvelope {
    pub fn signing_bytes(&self) -> Result<Vec<u8>, serde_json::Error> {
        serde_json::to_vec(&LatentZoneAttemptSigningEnvelope {
            schema_version: self.schema_version,
            world_id: &self.world_id,
            zone_id: &self.zone_id,
            actor_id: &self.actor_id,
            seq: self.seq,
            observed_state_hash: &self.observed_state_hash,
            phenomenon_id: &self.phenomenon_id,
            source_event_ids: &self.source_event_ids,
            budget: self.budget,
            created_at_logical: self.created_at_logical,
            public_key_hex: &self.public_key_hex,
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactEffectPayload {
    pub artifact_id: String,
    pub action: String,
    pub source_event_ids: Vec<String>,
    pub effect_id: Option<String>,
    pub effect_kind: Option<String>,
    pub magnitude: Option<u16>,
    pub duration_ticks: Option<u16>,
    pub feedback_class: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactEffectRule {
    pub artifact_id: String,
    pub accepted_actions: Vec<String>,
    pub required_fragment_ids: Vec<String>,
    pub required_world_signals: Vec<String>,
    pub minimum_witnesses: u16,
    pub effect_id: String,
    pub effect_kind: String,
    pub magnitude: u16,
    pub duration_ticks: u16,
    pub feedback_class: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactExperimentEnvelope {
    pub schema_version: u16,
    pub world_id: String,
    pub zone_id: String,
    pub actor_id: String,
    pub seq: u64,
    pub observed_state_hash: String,
    pub artifact_id: String,
    pub action: String,
    pub observed_fragment_ids: Vec<String>,
    pub source_event_ids: Vec<String>,
    pub witness_actor_ids: Vec<String>,
    pub witness_attestations: Vec<ArtifactWitnessAttestation>,
    pub budget: u16,
    pub created_at_logical: u64,
    pub model_class: String,
    pub public_key_hex: String,
    pub signature_hex: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactWitnessAttestation {
    pub actor_id: String,
    pub public_key_hex: String,
    pub signature_hex: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ArtifactSigningEnvelope<'a> {
    schema_version: u16,
    world_id: &'a str,
    zone_id: &'a str,
    actor_id: &'a str,
    seq: u64,
    observed_state_hash: &'a str,
    artifact_id: &'a str,
    action: &'a str,
    observed_fragment_ids: &'a [String],
    source_event_ids: &'a [String],
    witness_actor_ids: &'a [String],
    budget: u16,
    created_at_logical: u64,
    model_class: &'a str,
    public_key_hex: &'a str,
}

impl ArtifactExperimentEnvelope {
    pub fn signing_bytes(&self) -> Result<Vec<u8>, serde_json::Error> {
        serde_json::to_vec(&ArtifactSigningEnvelope {
            schema_version: self.schema_version,
            world_id: &self.world_id,
            zone_id: &self.zone_id,
            actor_id: &self.actor_id,
            seq: self.seq,
            observed_state_hash: &self.observed_state_hash,
            artifact_id: &self.artifact_id,
            action: &self.action,
            observed_fragment_ids: &self.observed_fragment_ids,
            source_event_ids: &self.source_event_ids,
            witness_actor_ids: &self.witness_actor_ids,
            budget: self.budget,
            created_at_logical: self.created_at_logical,
            model_class: &self.model_class,
            public_key_hex: &self.public_key_hex,
        })
    }

    pub fn witness_signing_bytes(
        &self,
        witness_actor_id: &str,
    ) -> Result<Vec<u8>, serde_json::Error> {
        let mut bytes = self.signing_bytes()?;
        bytes.extend_from_slice(b"|witness|");
        bytes.extend_from_slice(witness_actor_id.as_bytes());
        Ok(bytes)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimSharePayload {
    pub claim_id: String,
    pub source_event_ids: Vec<String>,
    pub audience_actor_ids: Vec<String>,
    pub proposition_hash: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimShareEnvelope {
    pub schema_version: u16,
    pub world_id: String,
    pub zone_id: String,
    pub actor_id: String,
    pub seq: u64,
    pub observed_state_hash: String,
    pub claim_id: String,
    pub source_event_ids: Vec<String>,
    pub audience_actor_ids: Vec<String>,
    pub proposition_hash: String,
    pub budget: u16,
    pub created_at_logical: u64,
    pub public_key_hex: String,
    pub signature_hex: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ClaimShareSigningEnvelope<'a> {
    schema_version: u16,
    world_id: &'a str,
    zone_id: &'a str,
    actor_id: &'a str,
    seq: u64,
    observed_state_hash: &'a str,
    claim_id: &'a str,
    source_event_ids: &'a [String],
    audience_actor_ids: &'a [String],
    proposition_hash: &'a str,
    budget: u16,
    created_at_logical: u64,
    public_key_hex: &'a str,
}

impl ClaimShareEnvelope {
    pub fn signing_bytes(&self) -> Result<Vec<u8>, serde_json::Error> {
        serde_json::to_vec(&ClaimShareSigningEnvelope {
            schema_version: self.schema_version,
            world_id: &self.world_id,
            zone_id: &self.zone_id,
            actor_id: &self.actor_id,
            seq: self.seq,
            observed_state_hash: &self.observed_state_hash,
            claim_id: &self.claim_id,
            source_event_ids: &self.source_event_ids,
            audience_actor_ids: &self.audience_actor_ids,
            proposition_hash: &self.proposition_hash,
            budget: self.budget,
            created_at_logical: self.created_at_logical,
            public_key_hex: &self.public_key_hex,
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActorState {
    pub x: i32,
    pub y: i32,
    pub last_seq: u64,
}

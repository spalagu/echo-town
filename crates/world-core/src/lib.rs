use std::collections::BTreeMap;

use echo_town_protocol::{
    ActorState, IntentEnvelope, MAX_INTENT_BUDGET, PROTOCOL_VERSION, WorldEvent,
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
        }
    }
}

pub struct WorldCore {
    state: WorldState,
    actor_public_keys: BTreeMap<String, String>,
    events: Vec<WorldEvent>,
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
                actors: actor_states,
            },
            actor_public_keys,
            events: Vec::new(),
        }
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
        let actor = self
            .state
            .actors
            .get_mut(&intent.actor_id)
            .expect("validated actor");
        actor.x += i32::from(intent.payload.dx);
        actor.y += i32::from(intent.payload.dy);
        actor.last_seq = intent.seq;
        self.state.logical_time += 1;
        let next_state_hash = self.state_hash();
        let accepted_intent_hash = hex::encode(Sha256::digest(
            intent.signing_bytes().map_err(|_| RejectReason::Encoding)?,
        ));
        let event = WorldEvent {
            schema_version: PROTOCOL_VERSION,
            world_id: self.state.world_id.clone(),
            zone_id: self.state.zone_id.clone(),
            epoch: self.state.epoch,
            event_seq: self.events.len() as u64 + 1,
            previous_state_hash,
            accepted_intent_hash,
            event_type: "ActorMoved".to_owned(),
            actor_id: intent.actor_id.clone(),
            payload: intent.payload.clone(),
            next_state_hash,
            authority_id: self.state.authority_id.clone(),
        };
        self.events.push(event.clone());
        Ok(event)
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
            inner: WorldCore::new(config.world_id, config.zone_id, config.authority_id, actors),
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
    pub fn state_hash(&self) -> String {
        self.inner.state_hash()
    }

    #[wasm_bindgen]
    pub fn snapshot(&self) -> Result<String, JsError> {
        serde_json::to_string(self.inner.state()).map_err(|error| JsError::new(&error.to_string()))
    }
}

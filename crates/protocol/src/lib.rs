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
    pub payload: IntentPayload,
    pub next_state_hash: String,
    pub authority_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActorState {
    pub x: i32,
    pub y: i32,
    pub last_seq: u64,
}

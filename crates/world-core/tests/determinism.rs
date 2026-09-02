use echo_town_protocol::{ActorState, IntentEnvelope, IntentPayload, PROTOCOL_VERSION};
use echo_town_world_core::{RejectReason, WorldCore};
use ed25519_dalek::{Signer, SigningKey};

fn key_material() -> (SigningKey, String) {
    let bytes = [7_u8; 32];
    let signing_key = SigningKey::from_bytes(&bytes);
    let public_key_hex = hex::encode(signing_key.verifying_key().to_bytes());
    (signing_key, public_key_hex)
}

fn core(public_key_hex: &str) -> WorldCore {
    WorldCore::new(
        "echo-town-test",
        "center",
        "authority-fixture",
        vec![(
            "actor-fixture".to_owned(),
            public_key_hex.to_owned(),
            ActorState {
                x: 0,
                y: 0,
                last_seq: 0,
            },
        )],
    )
}

fn signed_intent(
    signing_key: &SigningKey,
    public_key_hex: &str,
    seq: u64,
    observed_state_hash: String,
    dx: i16,
    dy: i16,
) -> IntentEnvelope {
    let mut intent = IntentEnvelope {
        schema_version: PROTOCOL_VERSION,
        world_id: "echo-town-test".to_owned(),
        zone_id: "center".to_owned(),
        actor_id: "actor-fixture".to_owned(),
        seq,
        observed_state_hash,
        intent_type: "move".to_owned(),
        payload: IntentPayload { dx, dy },
        budget: 1,
        created_at_logical: seq - 1,
        model_class: "rules".to_owned(),
        public_key_hex: public_key_hex.to_owned(),
        signature_hex: String::new(),
    };
    let signature: ed25519_dalek::Signature = signing_key.sign(&intent.signing_bytes().unwrap());
    intent.signature_hex = hex::encode(signature.to_bytes());
    intent
}

#[test]
fn two_independent_instances_match_for_ten_thousand_ticks() {
    let (signing_key, public_key_hex) = key_material();
    let mut left = core(&public_key_hex);
    let mut right = core(&public_key_hex);
    let mut checkpoints = 0;
    for seq in 1..=10_000 {
        let intent = signed_intent(
            &signing_key,
            &public_key_hex,
            seq,
            left.state_hash(),
            if seq % 3 == 0 { -1 } else { 1 },
            if seq % 5 == 0 { 1 } else { 0 },
        );
        let left_event = left.apply_intent(&intent).unwrap();
        let right_event = right.apply_intent(&intent).unwrap();
        assert_eq!(left_event, right_event);
        if seq % 100 == 0 {
            assert_eq!(left.state_hash(), right.state_hash());
            checkpoints += 1;
        }
    }
    assert_eq!(checkpoints, 100);
    assert_eq!(left.events().len(), 10_000);
}

#[test]
fn mutation_diverges_and_invalid_intents_fail_closed() {
    let (signing_key, public_key_hex) = key_material();
    let mut baseline = core(&public_key_hex);
    let mut mutated = core(&public_key_hex);
    for seq in 1..=5_001 {
        let baseline_intent = signed_intent(
            &signing_key,
            &public_key_hex,
            seq,
            baseline.state_hash(),
            1,
            0,
        );
        baseline.apply_intent(&baseline_intent).unwrap();
        let mutated_dx = if seq == 5_000 { -1 } else { 1 };
        let mutated_intent = signed_intent(
            &signing_key,
            &public_key_hex,
            seq,
            mutated.state_hash(),
            mutated_dx,
            0,
        );
        mutated.apply_intent(&mutated_intent).unwrap();
    }
    assert_ne!(baseline.state_hash(), mutated.state_hash());

    let mut replay = signed_intent(
        &signing_key,
        &public_key_hex,
        5_001,
        baseline.state_hash(),
        1,
        0,
    );
    replay.seq = 5_000;
    assert_eq!(baseline.apply_intent(&replay), Err(RejectReason::Sequence));

    let mut oversized = signed_intent(
        &signing_key,
        &public_key_hex,
        5_002,
        baseline.state_hash(),
        1,
        0,
    );
    oversized.payload.dx = 9;
    assert_eq!(
        baseline.apply_intent(&oversized),
        Err(RejectReason::MovementRange)
    );

    let mut bad_signature = signed_intent(
        &signing_key,
        &public_key_hex,
        5_002,
        baseline.state_hash(),
        1,
        0,
    );
    bad_signature.signature_hex.replace_range(0..2, "00");
    assert_eq!(
        baseline.apply_intent(&bad_signature),
        Err(RejectReason::Signature)
    );
}

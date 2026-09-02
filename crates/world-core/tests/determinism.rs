use std::collections::BTreeMap;

use echo_town_protocol::{
    ActorState, ArtifactEffectRule, ArtifactExperimentEnvelope, ArtifactWitnessAttestation,
    ClaimShareEnvelope, IntentEnvelope, IntentPayload, PROTOCOL_VERSION, WorldEventPayload,
};
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

fn artifact_core(public_key_hex: &str, witness_public_key_hex: &str) -> WorldCore {
    let actors = vec![
        (
            "actor-fixture".to_owned(),
            public_key_hex.to_owned(),
            ActorState {
                x: 0,
                y: 0,
                last_seq: 0,
            },
        ),
        (
            "actor-witness".to_owned(),
            witness_public_key_hex.to_owned(),
            ActorState {
                x: 0,
                y: 0,
                last_seq: 0,
            },
        ),
    ];
    WorldCore::new("echo-town-test", "center", "authority-fixture", actors).with_artifact_rules(
        vec![
            ArtifactEffectRule {
                artifact_id: "quiet-token".to_owned(),
                accepted_actions: vec!["listen_beside".to_owned()],
                required_fragment_ids: vec!["clue-a".to_owned(), "clue-b".to_owned()],
                required_world_signals: vec!["weather:light-rain".to_owned()],
                minimum_witnesses: 2,
                effect_id: "echo-pulse".to_owned(),
                effect_kind: "observation_pulse".to_owned(),
                magnitude: 24,
                duration_ticks: 3,
                feedback_class: "ambiguous".to_owned(),
            },
            ArtifactEffectRule {
                artifact_id: "quiet-token".to_owned(),
                accepted_actions: vec!["tap_softly".to_owned()],
                required_fragment_ids: vec!["clue-c".to_owned()],
                required_world_signals: vec!["place:closing-hour".to_owned()],
                minimum_witnesses: 1,
                effect_id: "paper-resonance".to_owned(),
                effect_kind: "artifact_resonance".to_owned(),
                magnitude: 18,
                duration_ticks: 4,
                feedback_class: "resonant".to_owned(),
            },
        ],
        vec![
            "event-a".to_owned(),
            "event-b".to_owned(),
            "event-c".to_owned(),
        ],
        BTreeMap::from([
            ("clue-a".to_owned(), "event-a".to_owned()),
            ("clue-b".to_owned(), "event-b".to_owned()),
            ("clue-c".to_owned(), "event-c".to_owned()),
        ]),
        vec![
            "weather:light-rain".to_owned(),
            "place:closing-hour".to_owned(),
        ],
        BTreeMap::from([(
            "actor-fixture".to_owned(),
            vec![
                "clue-a".to_owned(),
                "clue-b".to_owned(),
                "clue-c".to_owned(),
            ],
        )]),
    )
}

struct ArtifactExperimentCase<'a> {
    action: &'a str,
    observed_fragment_ids: Vec<&'a str>,
    source_event_ids: Vec<&'a str>,
    witness_actor_ids: Vec<&'a str>,
}

fn signed_artifact_experiment(
    signing_key: &SigningKey,
    witness_signing_key: Option<&SigningKey>,
    public_key_hex: &str,
    seq: u64,
    observed_state_hash: String,
    case: ArtifactExperimentCase<'_>,
) -> ArtifactExperimentEnvelope {
    let mut intent = ArtifactExperimentEnvelope {
        schema_version: PROTOCOL_VERSION,
        world_id: "echo-town-test".to_owned(),
        zone_id: "center".to_owned(),
        actor_id: "actor-fixture".to_owned(),
        seq,
        observed_state_hash,
        artifact_id: "quiet-token".to_owned(),
        action: case.action.to_owned(),
        observed_fragment_ids: case
            .observed_fragment_ids
            .into_iter()
            .map(str::to_owned)
            .collect(),
        source_event_ids: case
            .source_event_ids
            .into_iter()
            .map(str::to_owned)
            .collect(),
        witness_actor_ids: case
            .witness_actor_ids
            .into_iter()
            .map(str::to_owned)
            .collect(),
        witness_attestations: Vec::new(),
        budget: 3,
        created_at_logical: seq - 1,
        model_class: "rules".to_owned(),
        public_key_hex: public_key_hex.to_owned(),
        signature_hex: String::new(),
    };
    if let Some(witness_key) = witness_signing_key {
        let signature: ed25519_dalek::Signature =
            witness_key.sign(&intent.witness_signing_bytes("actor-witness").unwrap());
        intent
            .witness_attestations
            .push(ArtifactWitnessAttestation {
                actor_id: "actor-witness".to_owned(),
                public_key_hex: hex::encode(witness_key.verifying_key().to_bytes()),
                signature_hex: hex::encode(signature.to_bytes()),
            });
    }
    let signature: ed25519_dalek::Signature = signing_key.sign(&intent.signing_bytes().unwrap());
    intent.signature_hex = hex::encode(signature.to_bytes());
    intent
}

fn signed_claim_share(
    signing_key: &SigningKey,
    public_key_hex: &str,
    seq: u64,
    observed_state_hash: String,
    source_event_ids: Vec<&str>,
) -> ClaimShareEnvelope {
    let mut intent = ClaimShareEnvelope {
        schema_version: PROTOCOL_VERSION,
        world_id: "echo-town-test".to_owned(),
        zone_id: "center".to_owned(),
        actor_id: "actor-fixture".to_owned(),
        seq,
        observed_state_hash,
        claim_id: "claim-observed-pattern".to_owned(),
        source_event_ids: source_event_ids.into_iter().map(str::to_owned).collect(),
        audience_actor_ids: vec!["actor-witness".to_owned()],
        proposition_hash: "11".repeat(32),
        budget: 2,
        created_at_logical: seq - 1,
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

#[test]
fn artifact_effects_are_deterministic_world_events_and_fail_closed() {
    let (signing_key, public_key_hex) = key_material();
    let witness_signing_key = SigningKey::from_bytes(&[8_u8; 32]);
    let witness_public_key_hex = hex::encode(witness_signing_key.verifying_key().to_bytes());
    let mut left = artifact_core(&public_key_hex, &witness_public_key_hex);
    let mut right = artifact_core(&public_key_hex, &witness_public_key_hex);
    let intent = signed_artifact_experiment(
        &signing_key,
        Some(&witness_signing_key),
        &public_key_hex,
        1,
        left.state_hash(),
        ArtifactExperimentCase {
            action: "listen_beside",
            observed_fragment_ids: vec!["clue-a", "clue-b"],
            source_event_ids: vec!["event-a", "event-b"],
            witness_actor_ids: vec!["actor-fixture", "actor-witness"],
        },
    );
    let left_event = left.apply_artifact_experiment(&intent).unwrap();
    let right_event = right.apply_artifact_experiment(&intent).unwrap();
    assert_eq!(left_event, right_event);
    assert_eq!(left_event.event_type, "ArtifactEffectObserved");
    match &left_event.payload {
        WorldEventPayload::ArtifactEffect(payload) => {
            assert_eq!(payload.effect_id.as_deref(), Some("echo-pulse"));
            assert_eq!(payload.effect_kind.as_deref(), Some("observation_pulse"));
            assert_eq!(payload.magnitude, Some(24));
            assert_eq!(payload.duration_ticks, Some(3));
            assert_eq!(payload.feedback_class, "ambiguous");
        }
        _ => panic!("物品实验不得伪装成其他事件"),
    }
    let serialized = serde_json::to_string(&left_event).unwrap();
    assert!(!serialized.contains("requiredFragmentIds"));
    assert!(!serialized.contains("requiredWorldSignals"));
    assert_eq!(left.state_hash(), right.state_hash());

    let mut missing_attestation = intent.clone();
    missing_attestation.witness_attestations.clear();
    let mut missing_attestation_core = artifact_core(&public_key_hex, &witness_public_key_hex);
    assert_eq!(
        missing_attestation_core.apply_artifact_experiment(&missing_attestation),
        Err(RejectReason::WitnessSignature)
    );

    let feedback = signed_artifact_experiment(
        &signing_key,
        None,
        &public_key_hex,
        2,
        left.state_hash(),
        ArtifactExperimentCase {
            action: "listen_beside",
            observed_fragment_ids: vec!["clue-a"],
            source_event_ids: vec!["event-a"],
            witness_actor_ids: vec!["actor-fixture"],
        },
    );
    let feedback_event = left.apply_artifact_experiment(&feedback).unwrap();
    assert_eq!(feedback_event.event_type, "ArtifactExperimentFeedback");
    match feedback_event.payload {
        WorldEventPayload::ArtifactEffect(payload) => {
            assert_eq!(payload.effect_id, None);
            assert_eq!(payload.effect_kind, None);
            assert_eq!(payload.magnitude, None);
            assert_eq!(payload.duration_ticks, None);
        }
        _ => panic!("有限反馈不得伪装成其他事件"),
    }

    let mut unknown_source = signed_artifact_experiment(
        &signing_key,
        None,
        &public_key_hex,
        3,
        left.state_hash(),
        ArtifactExperimentCase {
            action: "tap_softly",
            observed_fragment_ids: vec!["clue-c"],
            source_event_ids: vec!["invented-event"],
            witness_actor_ids: vec!["actor-fixture"],
        },
    );
    assert_eq!(
        left.apply_artifact_experiment(&unknown_source),
        Err(RejectReason::SourceEvent)
    );

    unknown_source.source_event_ids = vec!["event-c".to_owned()];
    assert_eq!(
        left.apply_artifact_experiment(&unknown_source),
        Err(RejectReason::Signature)
    );
}

#[test]
fn claim_propagation_is_a_signed_world_event_with_real_audience_and_sources() {
    let (signing_key, public_key_hex) = key_material();
    let witness_signing_key = SigningKey::from_bytes(&[8_u8; 32]);
    let witness_public_key_hex = hex::encode(witness_signing_key.verifying_key().to_bytes());
    let mut core = artifact_core(&public_key_hex, &witness_public_key_hex);
    let intent = signed_claim_share(
        &signing_key,
        &public_key_hex,
        1,
        core.state_hash(),
        vec!["event-a"],
    );
    let event = core.apply_claim_share(&intent).unwrap();
    let shared_source_id = event.accepted_intent_hash.clone();
    assert_eq!(event.event_type, "ClaimShared");
    match event.payload {
        WorldEventPayload::ClaimShare(payload) => {
            assert_eq!(payload.claim_id, "claim-observed-pattern");
            assert_eq!(payload.source_event_ids, ["event-a"]);
            assert_eq!(payload.audience_actor_ids, ["actor-witness"]);
        }
        _ => panic!("观点传播必须产生 ClaimShared WorldEvent"),
    }

    let follow_up = signed_claim_share(
        &signing_key,
        &public_key_hex,
        2,
        core.state_hash(),
        vec![&shared_source_id],
    );
    assert_eq!(
        core.apply_claim_share(&follow_up).unwrap().event_type,
        "ClaimShared"
    );

    let mut self_audience = signed_claim_share(
        &signing_key,
        &public_key_hex,
        3,
        core.state_hash(),
        vec!["event-a"],
    );
    self_audience.audience_actor_ids = vec!["actor-fixture".to_owned()];
    assert_eq!(
        core.apply_claim_share(&self_audience),
        Err(RejectReason::Audience)
    );

    let mut unknown_source = signed_claim_share(
        &signing_key,
        &public_key_hex,
        3,
        core.state_hash(),
        vec!["event-a"],
    );
    unknown_source.source_event_ids = vec!["invented-event".to_owned()];
    assert_eq!(
        core.apply_claim_share(&unknown_source),
        Err(RejectReason::SourceEvent)
    );

    let actors = vec![
        (
            "actor-fixture".to_owned(),
            public_key_hex.clone(),
            ActorState {
                x: 0,
                y: 0,
                last_seq: 0,
            },
        ),
        (
            "actor-witness".to_owned(),
            witness_public_key_hex,
            ActorState {
                x: 0,
                y: 0,
                last_seq: 0,
            },
        ),
    ];
    let mut hidden_source_core =
        WorldCore::new("echo-town-test", "center", "authority-fixture", actors)
            .with_artifact_rules(
                Vec::new(),
                vec!["secret-event".to_owned()],
                BTreeMap::from([("secret-clue".to_owned(), "secret-event".to_owned())]),
                Vec::new(),
                BTreeMap::new(),
            );
    let invisible_source = signed_claim_share(
        &signing_key,
        &public_key_hex,
        1,
        hidden_source_core.state_hash(),
        vec!["secret-event"],
    );
    assert_eq!(
        hidden_source_core.apply_claim_share(&invisible_source),
        Err(RejectReason::SourceVisibility)
    );
}

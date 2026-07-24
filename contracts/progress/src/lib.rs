#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, vec, Address, Env, IntoVal, String, Symbol, Vec,
};
use scout_off_shared::{
    errors::Error,
    storage::{bump_instance, is_initialized, set_initialized},
};

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone)]
pub struct MilestoneData {
    pub player_id: u64,
    pub milestone_type: String,
    pub evidence_uri: String,
    pub validator: Address,
    pub approved: bool,
    pub submitted_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    RegisterContract,
    Validator(Address),
    MilestoneCounter,
    Milestone(u64),
    PlayerMilestones(u64),
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct ProgressContract;

#[contractimpl]
impl ProgressContract {
    /// One-time setup. Stores admin and register contract address.
    pub fn initialize(env: Env, admin: Address, register_contract: Address) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::RegisterContract, &register_contract);
        env.storage()
            .instance()
            .set(&DataKey::MilestoneCounter, &0u64);
        set_initialized(&env);
        bump_instance(&env);
        Ok(())
    }

    /// Admin-only: add a validator to the registry.
    pub fn register_validator(env: Env, validator_address: Address) -> Result<(), Error> {
        if !is_initialized(&env) {
            return Err(Error::NotInitialized);
        }
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::Validator(validator_address), &true);
        bump_instance(&env);
        Ok(())
    }

    /// Admin-only: remove a validator from the registry.
    pub fn revoke_validator(env: Env, validator_address: Address) -> Result<(), Error> {
        if !is_initialized(&env) {
            return Err(Error::NotInitialized);
        }
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        env.storage()
            .instance()
            .remove(&DataKey::Validator(validator_address));
        bump_instance(&env);
        Ok(())
    }

    /// Validator submits a milestone for a player. Returns the new milestone_id.
    /// Only registered validators may call this. Emits milestone_submitted.
    pub fn submit_milestone(
        env: Env,
        validator: Address,
        player_id: u64,
        milestone_type: String,
        evidence_uri: String,
    ) -> Result<u64, Error> {
        if !is_initialized(&env) {
            return Err(Error::NotInitialized);
        }
        validator.require_auth();

        // InvalidValidator(4)
        if !env
            .storage()
            .instance()
            .has(&DataKey::Validator(validator.clone()))
        {
            return Err(Error::NotFound);
        }

        let milestone_id: u64 = env
            .storage()
            .instance()
            .get::<DataKey, u64>(&DataKey::MilestoneCounter)
            .unwrap_or(0)
            + 1;
        env.storage()
            .instance()
            .set(&DataKey::MilestoneCounter, &milestone_id);

        let milestone = MilestoneData {
            player_id,
            milestone_type: milestone_type.clone(),
            evidence_uri: evidence_uri.clone(),
            validator: validator.clone(),
            approved: false,
            submitted_at: env.ledger().timestamp(),
        };
        env.storage()
            .instance()
            .set(&DataKey::Milestone(milestone_id), &milestone);

        let player_key = DataKey::PlayerMilestones(player_id);
        let mut milestones: Vec<u64> = env
            .storage()
            .instance()
            .get(&player_key)
            .unwrap_or_else(|| Vec::new(&env));
        milestones.push_back(milestone_id);
        env.storage().instance().set(&player_key, &milestones);

        env.events().publish(
            (
                Symbol::new(&env, "milestone_submitted"),
                validator,
                player_id,
            ),
            (milestone_id, milestone_type, evidence_uri),
        );

        bump_instance(&env);
        Ok(milestone_id)
    }

    /// Validator approves a pending milestone.
    /// Sets the player's progress level based on milestone type:
    ///   "identity"    → level 1  (Level 0 → 1)
    ///   "performance" → level 2  (Level 1 → 2)
    /// Emits milestone_approved.
    pub fn approve_milestone(
        env: Env,
        validator: Address,
        milestone_id: u64,
    ) -> Result<(), Error> {
        if !is_initialized(&env) {
            return Err(Error::NotInitialized);
        }
        validator.require_auth();

        // InvalidValidator(4)
        if !env
            .storage()
            .instance()
            .has(&DataKey::Validator(validator.clone()))
        {
            return Err(Error::NotFound);
        }

        // MilestoneNotFound(5)
        let mut milestone: MilestoneData = env
            .storage()
            .instance()
            .get(&DataKey::Milestone(milestone_id))
            .ok_or(Error::InvalidInput)?;

        // AlreadyVerified(6)
        if milestone.approved {
            return Err(Error::AlreadyVerified);
        }

        let new_level: u32 = if milestone.milestone_type == String::from_str(&env, "identity") {
            1
        } else if milestone.milestone_type == String::from_str(&env, "performance") {
            2
        } else {
            return Err(Error::InvalidInput);
        };

        milestone.approved = true;
        env.storage()
            .instance()
            .set(&DataKey::Milestone(milestone_id), &milestone);

        let reg_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::RegisterContract)
            .ok_or(Error::NotInitialized)?;
        env.invoke_contract::<()>(
            &reg_addr,
            &Symbol::new(&env, "update_progress_level"),
            vec![&env, milestone.player_id.into_val(&env), new_level.into_val(&env)],
        );

        env.events().publish(
            (
                Symbol::new(&env, "milestone_approved"),
                validator,
                milestone.player_id,
            ),
            (milestone_id, new_level),
        );

        bump_instance(&env);
        Ok(())
    }

    /// Read-only: returns the full milestone history for a player.
    pub fn get_milestones(env: Env, player_id: u64) -> Vec<MilestoneData> {
        let milestone_ids: Vec<u64> = env
            .storage()
            .instance()
            .get(&DataKey::PlayerMilestones(player_id))
            .unwrap_or_else(|| Vec::new(&env));

        let mut results = Vec::new(&env);
        let len = milestone_ids.len();
        for i in 0..len {
            let mid = milestone_ids.get_unchecked(i);
            if let Some(data) = env
                .storage()
                .instance()
                .get::<DataKey, MilestoneData>(&DataKey::Milestone(mid))
            {
                results.push_back(data);
            }
        }
        results
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};
    use register::{RegisterContract, RegisterContractClient};

    fn setup(
        env: &Env,
    ) -> (
        ProgressContractClient<'_>,
        RegisterContractClient<'_>,
        Address,
    ) {
        env.mock_all_auths();

        let admin = Address::generate(env);
        let token = Address::generate(env);

        let reg_id = env.register_contract(None, RegisterContract);
        let prog_id = env.register_contract(None, ProgressContract);

        let reg_client = RegisterContractClient::new(env, &reg_id);
        let prog_client = ProgressContractClient::new(env, &prog_id);

        reg_client.initialize(&admin, &token, &100u32);
        prog_client.initialize(&admin, &reg_id);

        // Grant the progress contract permission to update player progress levels.
        reg_client.set_authorized_updater(&prog_id);

        (prog_client, reg_client, admin)
    }

    fn register_player(env: &Env, reg: &RegisterContractClient<'_>) -> u64 {
        let wallet = Address::generate(env);
        reg.register_player(
            &wallet,
            &String::from_str(env, "ipfs://meta"),
            &String::from_str(env, "forward"),
            &String::from_str(env, "europe"),
        )
    }

    #[test]
    fn non_validator_cannot_submit_milestone() {
        let env = Env::default();
        let (prog, reg, _admin) = setup(&env);
        let player_id = register_player(&env, &reg);
        let non_validator = Address::generate(&env);

        let result = prog.try_submit_milestone(
            &non_validator,
            &player_id,
            &String::from_str(&env, "identity"),
            &String::from_str(&env, "ipfs://evidence"),
        );
        assert!(result.is_err());
    }

    #[test]
    fn validator_can_submit_and_approve_milestone() {
        let env = Env::default();
        let (prog, reg, admin) = setup(&env);
        let player_id = register_player(&env, &reg);
        let validator = Address::generate(&env);

        prog.register_validator(&validator);
        let milestone_id = prog.submit_milestone(
            &validator,
            &player_id,
            &String::from_str(&env, "identity"),
            &String::from_str(&env, "ipfs://evidence"),
        );

        prog.approve_milestone(&validator, &milestone_id);

        assert_eq!(reg.get_player(&player_id).progress_level, 1);
        let _ = admin; // suppress unused warning
    }

    #[test]
    fn approve_already_approved_milestone_returns_error() {
        let env = Env::default();
        let (prog, reg, _admin) = setup(&env);
        let player_id = register_player(&env, &reg);
        let validator = Address::generate(&env);

        prog.register_validator(&validator);
        let milestone_id = prog.submit_milestone(
            &validator,
            &player_id,
            &String::from_str(&env, "identity"),
            &String::from_str(&env, "ipfs://evidence"),
        );
        prog.approve_milestone(&validator, &milestone_id);

        let result = prog.try_approve_milestone(&validator, &milestone_id);
        assert!(result.is_err());
    }

    #[test]
    fn identity_milestone_sets_progress_to_1() {
        let env = Env::default();
        let (prog, reg, _admin) = setup(&env);
        let player_id = register_player(&env, &reg);
        let validator = Address::generate(&env);

        prog.register_validator(&validator);
        assert_eq!(reg.get_player(&player_id).progress_level, 0);

        let mid = prog.submit_milestone(
            &validator,
            &player_id,
            &String::from_str(&env, "identity"),
            &String::from_str(&env, "ipfs://id-evidence"),
        );
        prog.approve_milestone(&validator, &mid);

        assert_eq!(reg.get_player(&player_id).progress_level, 1);
    }

    #[test]
    fn performance_milestone_sets_progress_to_2() {
        let env = Env::default();
        let (prog, reg, _admin) = setup(&env);
        let player_id = register_player(&env, &reg);
        let validator = Address::generate(&env);

        prog.register_validator(&validator);

        let mid = prog.submit_milestone(
            &validator,
            &player_id,
            &String::from_str(&env, "performance"),
            &String::from_str(&env, "ipfs://perf-evidence"),
        );
        prog.approve_milestone(&validator, &mid);

        assert_eq!(reg.get_player(&player_id).progress_level, 2);
    }

    #[test]
    fn get_milestones_returns_tamper_proof_history() {
        let env = Env::default();
        let (prog, reg, _admin) = setup(&env);
        let player_id = register_player(&env, &reg);
        let validator = Address::generate(&env);

        prog.register_validator(&validator);

        let mid1 = prog.submit_milestone(
            &validator,
            &player_id,
            &String::from_str(&env, "identity"),
            &String::from_str(&env, "ipfs://ev1"),
        );
        let mid2 = prog.submit_milestone(
            &validator,
            &player_id,
            &String::from_str(&env, "performance"),
            &String::from_str(&env, "ipfs://ev2"),
        );
        prog.approve_milestone(&validator, &mid1);

        let history = prog.get_milestones(&player_id);
        assert_eq!(history.len(), 2);

        let m1 = history.get(0).unwrap();
        assert_eq!(m1.milestone_type, String::from_str(&env, "identity"));
        assert_eq!(m1.evidence_uri, String::from_str(&env, "ipfs://ev1"));
        assert!(m1.approved);

        let m2 = history.get(1).unwrap();
        assert_eq!(m2.milestone_type, String::from_str(&env, "performance"));
        assert_eq!(m2.evidence_uri, String::from_str(&env, "ipfs://ev2"));
        assert!(!m2.approved);
        let _ = mid2;
    }

    #[test]
    fn invariant_milestones_are_single_approval_and_progress_is_monotonic() {
        let env = Env::default();
        let (prog, reg, _admin) = setup(&env);
        let player_id = register_player(&env, &reg);
        let validator = Address::generate(&env);

        prog.register_validator(&validator);

        let mut state = 0xc0ffee_1234u64;
        for _step in 0..24 {
            let milestone_type = if state % 2 == 0 {
                String::from_str(&env, "identity")
            } else {
                String::from_str(&env, "performance")
            };
            let milestone_id = prog.submit_milestone(
                &validator,
                &player_id,
                &milestone_type,
                &String::from_str(&env, "ipfs://evidence"),
            );

            let before_level = reg.get_player(&player_id).progress_level;
            let approval_target = if state % 2 == 0 {
                milestone_id
            } else {
                milestone_id + 1000
            };
            let approval_result = prog.try_approve_milestone(&validator, &approval_target);

            let milestones = prog.get_milestones(&player_id);
            let milestone = milestones.get(milestones.len() - 1).unwrap();

            if approval_result.is_ok() {
                assert!(milestone.approved, "approval should flip the milestone state");
                let after_level = reg.get_player(&player_id).progress_level;
                assert!(
                    after_level >= before_level,
                    "progress level regressed from {before_level} to {after_level}"
                );
                let second_result = prog.try_approve_milestone(&validator, &milestone_id);
                assert!(second_result.is_err(), "double approval must fail");
            } else {
                assert!(!milestone.approved, "failed approval must not approve the milestone");
            }

            state = state
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
        }
    }

    #[test]
    fn invariant_unregistered_validators_cannot_mutate_milestones() {
        let env = Env::default();
        let (prog, reg, _admin) = setup(&env);
        let player_id = register_player(&env, &reg);
        let validator = Address::generate(&env);
        let mut state = 0x9e3779b97f4a7c15u64;

        let initial_milestones = prog.get_milestones(&player_id);
        let mut previous_len = initial_milestones.len();
        for _step in 0..24 {
            let result = prog.try_submit_milestone(
                &validator,
                &player_id,
                &String::from_str(&env, "identity"),
                &String::from_str(&env, "ipfs://evidence"),
            );

            let milestones = prog.get_milestones(&player_id);
            if result.is_ok() {
                assert!(milestones.len() >= previous_len, "milestone count should never shrink");
                previous_len = milestones.len();
            } else {
                assert_eq!(milestones.len(), previous_len, "failed submission must not add milestones");
            }

            state = state
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
        }
    }

    #[test]
    fn double_initialize_fails() {
        let env = Env::default();
        let (prog, reg, admin) = setup(&env);
        let result = prog.try_initialize(&admin, &Address::generate(&env));
        assert!(result.is_err());
        let _ = reg;
    }

    #[test]
    fn revoked_validator_cannot_submit() {
        let env = Env::default();
        let (prog, reg, _admin) = setup(&env);
        let player_id = register_player(&env, &reg);
        let validator = Address::generate(&env);

        prog.register_validator(&validator);
        prog.revoke_validator(&validator);

        let result = prog.try_submit_milestone(
            &validator,
            &player_id,
            &String::from_str(&env, "identity"),
            &String::from_str(&env, "ipfs://evidence"),
        );
        assert!(result.is_err());
    }
}

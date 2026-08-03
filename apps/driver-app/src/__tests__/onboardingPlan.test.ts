import { resolveOnboardingRoute, resolveResumeRoute, displayStepIndex, DISPLAY_TOTAL } from '../utils/onboardingPlan';

describe('onboarding display plan (SB2A compatibility layer)', () => {
  describe('displayStepIndex — visible order', () => {
    it('orders Personal(1) → Vehicle(2) → Documents(3)', () => {
      expect(displayStepIndex('/onboarding/personal-info')).toBe(0);
      expect(displayStepIndex('/onboarding/vehicle-info')).toBe(1);
      expect(displayStepIndex('/onboarding/document-upload')).toBe(2);
    });
    it('exposes the full founder-approved 10-stage total', () => {
      expect(DISPLAY_TOTAL).toBe(10);
    });
  });

  describe('resolveOnboardingRoute — completion-derived resume', () => {
    it('sends approved drivers to the dashboard', () => {
      expect(resolveOnboardingRoute({ status: 'approved', onboardingStep: 'complete' }, false)).toBe('/(tabs)');
    });

    it('starts a brand-new driver on Personal Information', () => {
      expect(resolveOnboardingRoute({ status: 'pending', onboardingStep: 'personal_info' }, false))
        .toBe('/onboarding/personal-info');
    });

    it('inserts Vehicle after Personal Info when no vehicle exists yet (new order)', () => {
      // Backend leaves the step at document_upload after personal info.
      expect(resolveOnboardingRoute({ status: 'pending', onboardingStep: 'document_upload' }, false))
        .toBe('/onboarding/vehicle-info');
    });

    it('advances to Documents once a vehicle has been added', () => {
      expect(resolveOnboardingRoute({ status: 'under_review', onboardingStep: 'document_upload' }, true))
        .toBe('/onboarding/document-upload');
    });

    it('does NOT send a driver backward when the vehicle check is unknown (transient failure)', () => {
      // A failed /vehicles/me must fall back to the canonical (forward-only)
      // resolver — never insert Vehicle, which would move a driver backward.
      expect(resolveOnboardingRoute({ status: 'pending', onboardingStep: 'document_upload' }, undefined))
        .toBe('/onboarding/document-upload');
    });

    it('leaves existing drivers past documents unchanged (delegates to canonical resolver)', () => {
      // An existing driver who already did documents resumes exactly as before.
      expect(resolveOnboardingRoute({ status: 'under_review', onboardingStep: 'background_check' }, true))
        .toBe('/onboarding/background-check');
      expect(resolveOnboardingRoute({ status: 'pending', onboardingStep: 'vehicle_info' }, true))
        .toBe('/onboarding/vehicle-info');
      expect(resolveOnboardingRoute({ status: 'pending', onboardingStep: 'bank_account' }, true))
        .toBe('/onboarding/bank-account');
    });
  });

  describe('resolveResumeRoute — shared retrying resolver (cold-start + login)', () => {
    // Successive /drivers/me responses come from `mePlan` (an entry may be an
    // Error to simulate a failure); /vehicles/me always returns `vehicles`.
    const mkGet = (mePlan: unknown[], vehicles: unknown[]) => {
      let call = 0;
      return async <T,>(path: string): Promise<T> => {
        if (path === '/drivers/me') {
          const entry = mePlan[Math.min(call, mePlan.length - 1)];
          call += 1;
          if (entry instanceof Error) throw entry;
          return entry as T;
        }
        if (path === '/vehicles/me') return vehicles as T;
        throw new Error(`unexpected path ${path}`);
      };
    };

    it('routes an approved driver to the dashboard', async () => {
      const get = mkGet([{ status: 'approved', onboardingStep: 'complete' }], []);
      expect(await resolveResumeRoute(get)).toBe('/(tabs)');
    });

    it('routes personal-done + no vehicle to Vehicle', async () => {
      const get = mkGet([{ status: 'pending', onboardingStep: 'document_upload' }], []);
      expect(await resolveResumeRoute(get)).toBe('/onboarding/vehicle-info');
    });

    it('recovers from a transient /drivers/me failure via retry (never mis-routes)', async () => {
      const get = mkGet([new Error('network'), { status: 'pending', onboardingStep: 'document_upload' }], [{}]);
      expect(await resolveResumeRoute(get)).toBe('/onboarding/document-upload');
    });

    it('returns null on session expiry (deferred to the central auth redirect)', async () => {
      const expired = Object.assign(new Error('expired'), { code: 'SESSION_EXPIRED' });
      const get = mkGet([expired], []);
      expect(await resolveResumeRoute(get)).toBeNull();
    });

    it('returns null when the profile is unreachable after retries', async () => {
      const get = mkGet([new Error('down'), new Error('down'), new Error('down')], []);
      expect(await resolveResumeRoute(get)).toBeNull();
    });
  });
});

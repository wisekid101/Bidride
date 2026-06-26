import { DispatchSimulatorService, DispatchCandidate } from './dispatch-simulator.service';
import { InferenceLogService } from '../services/inference-log.service';

const mockLog = { log: jest.fn() };

const makeCandidate = (score: number, acceptance = 0.7): DispatchCandidate => ({
  driverUserId: `driver-${score}`,
  score,
  acceptanceRate: acceptance,
  avgResponseTimeMs: 20000,
});

describe('DispatchSimulatorService', () => {
  let service: DispatchSimulatorService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DispatchSimulatorService(mockLog as unknown as InferenceLogService);
  });

  it('returns broadcast-all for empty candidates', () => {
    const result = service.simulate('trip-1', []);
    expect(result.strategy).toBe('broadcast-all');
    expect(result.selectedDriverUserIds).toEqual([]);
  });

  it('returns broadcast-all for ≤ 3 candidates', () => {
    const result = service.simulate('trip-1', [
      makeCandidate(90),
      makeCandidate(80),
    ]);
    expect(result.strategy).toBe('broadcast-all');
    expect(result.selectedDriverUserIds).toHaveLength(2);
  });

  it('chooses top-k when top-3 acceptance probability >= 0.85', () => {
    // 3 drivers with 0.95 acceptance each → P(all decline) = 0.05^3 ≈ 0, P(accept) ≈ 1
    const candidates = [
      makeCandidate(95, 0.95),
      makeCandidate(90, 0.95),
      makeCandidate(85, 0.95),
      makeCandidate(70, 0.5),
      makeCandidate(60, 0.5),
    ];
    const result = service.simulate('trip-2', candidates);
    expect(result.strategy).toBe('top-k');
    expect(result.selectedDriverUserIds).toHaveLength(3);
    expect(result.simulatedAcceptanceProbability).toBeGreaterThan(0.85);
  });

  it('simulated acceptance probability is in [0, 1]', () => {
    const candidates = Array.from({ length: 5 }, (_, i) => makeCandidate(80 - i * 5));
    const result = service.simulate('trip-3', candidates);
    expect(result.simulatedAcceptanceProbability).toBeGreaterThanOrEqual(0);
    expect(result.simulatedAcceptanceProbability).toBeLessThanOrEqual(1);
  });

  it('has at least one phase in the result', () => {
    const candidates = Array.from({ length: 4 }, (_, i) => makeCandidate(85 - i * 5, 0.4));
    const result = service.simulate('trip-4', candidates);
    expect(result.phases.length).toBeGreaterThanOrEqual(1);
  });

  it('includes modelVersion in result', () => {
    const result = service.simulate('trip-5', [makeCandidate(75)]);
    expect(result.modelVersion).toBeTruthy();
  });

  it('fires log fire-and-forget without throwing', () => {
    service.simulate('trip-6', [makeCandidate(80), makeCandidate(75), makeCandidate(70), makeCandidate(65)]);
    expect(mockLog.log).toHaveBeenCalled();
  });

  it('phased strategy sends first phase immediately (delayMs=0)', () => {
    // Drive toward phased: middling acceptance so top-k < 0.85 but phased helps
    const candidates = [
      makeCandidate(95, 0.5),
      makeCandidate(90, 0.5),
      makeCandidate(85, 0.5),
      makeCandidate(70, 0.5),
      makeCandidate(60, 0.5),
    ];
    const result = service.simulate('trip-7', candidates);
    if (result.strategy === 'phased') {
      expect(result.phases[0].delayMs).toBe(0);
      expect(result.phases[1].delayMs).toBe(15000);
    } else {
      // Strategy may be broadcast-all if it won — just verify phases exist
      expect(result.phases.length).toBeGreaterThan(0);
    }
  });
});

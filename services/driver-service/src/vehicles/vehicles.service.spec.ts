jest.mock('@bidride/database', () => ({ PrismaClient: jest.fn().mockImplementation(() => mockPrisma) }));

const mockPrisma = {
  driver: { findUnique: jest.fn(), update: jest.fn() },
  vehicle: { findFirst: jest.fn(), create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
} as any;

import { VehiclesService, AddVehicleDto } from './vehicles.service';

const validDto: AddVehicleDto = {
  make: 'Toyota',
  model: 'Camry',
  year: new Date().getFullYear(),
  color: 'Blue',
  licensePlate: 'ABC123',
  licensePlateState: 'NJ',
  vin: '1HGCM82633A004352',
  vehicleClass: 'standard',
};

describe('VehiclesService — Batch 1 cursor transitions', () => {
  let service: VehiclesService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.driver.update.mockResolvedValue({});
    mockPrisma.vehicle.create.mockResolvedValue({ id: 'veh-1' });
    mockPrisma.vehicle.update.mockResolvedValue({});
    service = new VehiclesService();
  });

  describe('addVehicle', () => {
    it('advances the cursor vehicle_info → document_upload (NOT vehicle_inspection)', async () => {
      mockPrisma.driver.findUnique.mockResolvedValue({ id: 'd1', onboardingStep: 'vehicle_info' });
      mockPrisma.vehicle.findFirst.mockResolvedValue(null);

      await service.addVehicle('u1', validDto);

      expect(mockPrisma.driver.update).toHaveBeenCalledWith({
        where: { id: 'd1' },
        data: { onboardingStep: 'document_upload' },
      });
      // vehicle_inspection is retired as a cursor.
      const wroteInspection = mockPrisma.driver.update.mock.calls.find(
        ([arg]: [any]) => arg?.data?.onboardingStep === 'vehicle_inspection',
      );
      expect(wroteInspection).toBeUndefined();
      // The Vehicle still records inspectionStatus=pending (admin attribute).
      expect(mockPrisma.vehicle.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ inspectionStatus: 'pending' }) }),
      );
    });

    it('does not advance the cursor when the driver is not at vehicle_info', async () => {
      mockPrisma.driver.findUnique.mockResolvedValue({ id: 'd1', onboardingStep: 'document_upload' });
      mockPrisma.vehicle.findFirst.mockResolvedValue(null);
      await service.addVehicle('u1', validDto);
      expect(mockPrisma.driver.update).not.toHaveBeenCalled();
    });
  });

  describe('approveInspection', () => {
    it('passes the inspection WITHOUT writing any onboardingStep (inspection is not a cursor)', async () => {
      mockPrisma.vehicle.findUnique.mockResolvedValue({ id: 'veh-1', driverId: 'd1' });

      await service.approveInspection('veh-1', 'admin-1');

      expect(mockPrisma.vehicle.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ inspectionStatus: 'passed' }) }),
      );
      expect(mockPrisma.driver.update).not.toHaveBeenCalled();
    });
  });
});

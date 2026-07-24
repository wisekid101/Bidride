'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  Clock,
  ShieldCheck,
  Car,
  FileText,
  User,
  CreditCard,
} from 'lucide-react';
import Link from 'next/link';

interface DriverDocument {
  id: string;
  documentType: string;
  status: string;
  createdAt: string;
  reviewNotes: string | null;
}

interface DriverVehicle {
  id: string;
  make: string;
  model: string;
  year: number;
  color: string;
  licensePlate: string;
  isActive: boolean;
  inspectionStatus: string;
}

interface DriverDetail {
  id: string;
  status: string;
  onboardingStep: string;
  legalFirstName: string;
  legalLastName: string;
  dateOfBirth: string;
  homeAddress: string | null;
  homeCity: string | null;
  homeState: string | null;
  homeZip: string | null;
  licenseNumber: string | null;
  licenseState: string | null;
  licenseExpiry: string | null;
  insuranceProvider: string | null;
  insurancePolicyNumber: string | null;
  insuranceExpiry: string | null;
  backgroundCheckStatus: string;
  appliedAt?: string;
  createdAt: string;
  user: { phone: string; email: string | null };
  vehicles: DriverVehicle[];
  documents: DriverDocument[];
  approvalRequirements: { met: boolean; missing: string[] };
}

const REQUIREMENT_LABELS: Record<string, string> = {
  'document_not_approved:drivers_license': "Driver's license document approved",
  'document_not_approved:insurance_card': 'Insurance card document approved',
  'document_not_approved:vehicle_registration': 'Vehicle registration document approved',
  no_active_vehicle: 'At least one active vehicle',
  insurance_info_missing: 'Insurance policy on file',
  insurance_expired: 'Insurance policy not expired',
  'zero_tolerance:not_accepted': 'Zero Tolerance policy accepted (current version)',
};

// background_check:* carries the current status in the key
function requirementLabel(key: string): string {
  if (key.startsWith('background_check:')) {
    return `Background check clear (currently: ${key.split(':')[1].replace(/_/g, ' ')})`;
  }
  return REQUIREMENT_LABELS[key] ?? key;
}

const DOC_LABELS: Record<string, string> = {
  drivers_license: "Driver's License",
  insurance: 'Insurance Card',
  insurance_card: 'Insurance Card',
  registration: 'Vehicle Registration',
  vehicle_registration: 'Vehicle Registration',
};

function fmtDate(d: string | null | undefined): string {
  return d ? new Date(d).toLocaleDateString() : '—';
}

export default function DriverDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [sendFcraLetter, setSendFcraLetter] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: driver, isLoading } = useQuery<DriverDetail>({
    queryKey: ['driver', id],
    queryFn: async () => {
      const res = await fetch(`/api/admin/drivers/${id}`);
      if (!res.ok) throw new Error('Failed to load driver');
      return res.json();
    },
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['driver', id] });

  const approveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/drivers/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        const missing = (data.missing as string[] | undefined)
          ?.map(requirementLabel)
          .join('; ');
        throw new Error(missing ? `Blocked: ${missing}` : data.message ?? 'Approve failed');
      }
      return data;
    },
    onSuccess: () => {
      setActionError(null);
      refresh();
    },
    onError: (e: Error) => setActionError(e.message),
  });

  const declineMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/drivers/${id}/decline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: declineReason, sendAdverseActionLetter: sendFcraLetter }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? 'Decline failed');
      return data;
    },
    onSuccess: () => {
      setActionError(null);
      setDeclineOpen(false);
      refresh();
    },
    onError: (e: Error) => setActionError(e.message),
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ docType, decision }: { docType: string; decision: 'approved' | 'rejected' }) => {
      const res = await fetch(`/api/admin/drivers/${id}/documents/${docType}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? 'Document review failed');
      return data;
    },
    onSuccess: () => {
      setActionError(null);
      refresh();
    },
    onError: (e: Error) => setActionError(e.message),
  });

  if (isLoading) {
    return <div className="p-6 text-muted-foreground text-sm">Loading driver…</div>;
  }
  if (!driver) {
    return <div className="p-6 text-muted-foreground text-sm">Driver not found.</div>;
  }

  const req = driver.approvalRequirements;
  const missingSet = new Set(req.missing);
  const isTerminal = driver.status === 'approved' || driver.status === 'declined';

  // Render the full checklist: satisfied items are those not present in missing[]
  const checklist = [
    {
      key: 'document_not_approved:drivers_license',
      label: "Driver's license document approved",
    },
    { key: 'document_not_approved:insurance_card', label: 'Insurance card document approved' },
    {
      key: 'document_not_approved:vehicle_registration',
      label: 'Vehicle registration document approved',
    },
    {
      key: 'background_check',
      label: 'Background check clear',
      failed: req.missing.find((m) => m.startsWith('background_check:')),
    },
    { key: 'no_active_vehicle', label: 'At least one active vehicle' },
    {
      key: 'insurance',
      label: 'Insurance policy on file and not expired',
      failed: req.missing.find((m) => m === 'insurance_info_missing' || m === 'insurance_expired'),
    },
    // Phase 3B: Zero Tolerance activation gate. Present in missing[] only when a
    // policy is published and the driver has not accepted the current version.
    { key: 'zero_tolerance:not_accepted', label: 'Zero Tolerance policy accepted' },
  ].map((item) => ({
    ...item,
    ok: item.failed !== undefined ? false : !missingSet.has(item.key),
    detail: item.failed ? requirementLabel(item.failed) : undefined,
  }));

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/drivers" className="text-muted-foreground hover:text-white">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-2xl font-bold text-white">
            {driver.legalFirstName} {driver.legalLastName}
          </h1>
          <span className="text-xs px-2 py-1 rounded-full font-medium bg-secondary text-teal-400 capitalize">
            {driver.status.replace(/_/g, ' ')}
          </span>
        </div>
        <button
          onClick={() => router.refresh()}
          className="text-xs text-muted-foreground hover:text-white"
        >
          Refresh
        </button>
      </div>

      {actionError && (
        <div className="bg-red-900/20 border border-red-500/40 text-red-300 text-sm rounded-xl p-4">
          {actionError}
        </div>
      )}

      {/* Approval Requirements */}
      <div className="bg-card rounded-xl border border-border p-5 space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-teal-400" />
          <h2 className="font-semibold text-white text-sm">Approval Requirements</h2>
          {req.met ? (
            <span className="text-xs text-teal-400">All requirements met</span>
          ) : (
            <span className="text-xs text-yellow-400">{req.missing.length} outstanding</span>
          )}
        </div>
        <ul className="space-y-2">
          {checklist.map((item) => (
            <li key={item.key} className="flex items-center gap-2 text-sm">
              {item.ok ? (
                <CheckCircle className="w-4 h-4 text-teal-400 flex-shrink-0" />
              ) : (
                <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
              )}
              <span className={item.ok ? 'text-white' : 'text-red-300'}>
                {item.detail ?? item.label}
              </span>
            </li>
          ))}
        </ul>

        {/* Actions */}
        {!isTerminal && (
          <div className="flex gap-3 pt-2">
            <button
              onClick={() => approveMutation.mutate()}
              disabled={!req.met || approveMutation.isPending}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
                req.met
                  ? 'bg-teal-400 text-navy-950 hover:bg-teal-300'
                  : 'bg-secondary text-muted-foreground cursor-not-allowed'
              }`}
              title={req.met ? 'Approve driver' : `Blocked: ${req.missing.map(requirementLabel).join('; ')}`}
            >
              {approveMutation.isPending ? 'Approving…' : 'Approve Driver'}
            </button>
            <button
              onClick={() => setDeclineOpen(true)}
              className="px-4 py-2 rounded-xl text-sm font-semibold bg-red-900/30 text-red-300 border border-red-500/40 hover:bg-red-900/50"
            >
              Decline
            </button>
          </div>
        )}
        {driver.status === 'approved' && (
          <p className="text-xs text-teal-400 pt-1">Driver is approved and can go online.</p>
        )}
        {driver.status === 'declined' && (
          <p className="text-xs text-red-300 pt-1">Application declined.</p>
        )}
      </div>

      {/* Personal Info */}
      <div className="bg-card rounded-xl border border-border p-5 space-y-2">
        <div className="flex items-center gap-2 mb-2">
          <User className="w-4 h-4 text-teal-400" />
          <h2 className="font-semibold text-white text-sm">Personal Information</h2>
        </div>
        <InfoRow label="Legal name" value={`${driver.legalFirstName} ${driver.legalLastName}`} />
        <InfoRow label="Date of birth" value={fmtDate(driver.dateOfBirth)} />
        <InfoRow label="Phone" value={driver.user.phone} />
        <InfoRow label="Email" value={driver.user.email ?? '—'} />
        <InfoRow
          label="Address"
          value={
            driver.homeAddress
              ? `${driver.homeAddress}, ${driver.homeCity}, ${driver.homeState} ${driver.homeZip}`
              : '—'
          }
        />
        <InfoRow label="Applied" value={fmtDate(driver.appliedAt ?? driver.createdAt)} />
        <InfoRow label="Onboarding step" value={driver.onboardingStep.replace(/_/g, ' ')} />
      </div>

      {/* License + Insurance */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-card rounded-xl border border-border p-5 space-y-2">
          <div className="flex items-center gap-2 mb-2">
            <CreditCard className="w-4 h-4 text-teal-400" />
            <h2 className="font-semibold text-white text-sm">Driver License</h2>
          </div>
          <InfoRow label="Number" value={driver.licenseNumber ?? '—'} />
          <InfoRow label="State" value={driver.licenseState ?? '—'} />
          <InfoRow label="Expires" value={fmtDate(driver.licenseExpiry)} />
        </div>
        <div className="bg-card rounded-xl border border-border p-5 space-y-2">
          <div className="flex items-center gap-2 mb-2">
            <ShieldCheck className="w-4 h-4 text-teal-400" />
            <h2 className="font-semibold text-white text-sm">Insurance</h2>
          </div>
          <InfoRow label="Provider" value={driver.insuranceProvider ?? '—'} />
          <InfoRow label="Policy #" value={driver.insurancePolicyNumber ?? '—'} />
          <InfoRow
            label="Expires"
            value={fmtDate(driver.insuranceExpiry)}
            danger={
              !!driver.insuranceExpiry && new Date(driver.insuranceExpiry) <= new Date()
            }
          />
        </div>
      </div>

      {/* Vehicles */}
      <div className="bg-card rounded-xl border border-border p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Car className="w-4 h-4 text-teal-400" />
          <h2 className="font-semibold text-white text-sm">Vehicles</h2>
        </div>
        {driver.vehicles.length === 0 && (
          <p className="text-sm text-muted-foreground">No vehicles on file.</p>
        )}
        {driver.vehicles.map((v) => (
          <div key={v.id} className="flex items-center justify-between text-sm">
            <span className="text-white">
              {v.year} {v.make} {v.model} · {v.color} · {v.licensePlate}
            </span>
            <span className="text-xs text-muted-foreground">
              {v.isActive ? 'active' : 'inactive'} · inspection {v.inspectionStatus}
            </span>
          </div>
        ))}
      </div>

      {/* Documents */}
      <div className="bg-card rounded-xl border border-border p-5 space-y-3">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-teal-400" />
          <h2 className="font-semibold text-white text-sm">Documents</h2>
        </div>
        {driver.documents.length === 0 && (
          <p className="text-sm text-muted-foreground">No documents uploaded.</p>
        )}
        {driver.documents.map((doc) => (
          <div key={doc.id} className="flex items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-2 min-w-0">
              <DocStatusIcon status={doc.status} />
              <span className="text-white truncate">
                {DOC_LABELS[doc.documentType] ?? doc.documentType}
              </span>
              <span className="text-xs text-muted-foreground capitalize">{doc.status}</span>
            </div>
            {doc.status !== 'approved' && !isTerminal && (
              <div className="flex gap-2 flex-shrink-0">
                <button
                  onClick={() => reviewMutation.mutate({ docType: doc.documentType, decision: 'approved' })}
                  disabled={reviewMutation.isPending}
                  className="text-xs px-2.5 py-1 rounded-lg bg-teal-400/10 text-teal-400 border border-teal-400/40 hover:bg-teal-400/20"
                >
                  Approve
                </button>
                <button
                  onClick={() => reviewMutation.mutate({ docType: doc.documentType, decision: 'rejected' })}
                  disabled={reviewMutation.isPending}
                  className="text-xs px-2.5 py-1 rounded-lg bg-red-900/20 text-red-300 border border-red-500/40 hover:bg-red-900/40"
                >
                  Reject
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Background Check */}
      <div className="bg-card rounded-xl border border-border p-5 space-y-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-teal-400" />
          <h2 className="font-semibold text-white text-sm">Background Check</h2>
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${
              driver.backgroundCheckStatus === 'clear'
                ? 'text-teal-400 bg-teal-900/20'
                : 'text-yellow-400 bg-yellow-900/20'
            }`}
          >
            {driver.backgroundCheckStatus.replace(/_/g, ' ')}
          </span>
        </div>
      </div>

      {/* Decline modal */}
      {declineOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-6">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md space-y-4">
            <h3 className="text-white font-semibold">Decline Application</h3>
            <textarea
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              placeholder="Reason for declining (required)…"
              rows={3}
              className="w-full bg-secondary border border-border rounded-xl p-3 text-sm text-white placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-teal-400"
            />
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={sendFcraLetter}
                onChange={(e) => setSendFcraLetter(e.target.checked)}
              />
              Send FCRA adverse action letter (required if declining due to background check)
            </label>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeclineOpen(false)}
                className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={() => declineMutation.mutate()}
                disabled={!declineReason.trim() || declineMutation.isPending}
                className={`px-4 py-2 rounded-xl text-sm font-semibold ${
                  declineReason.trim()
                    ? 'bg-red-500 text-white hover:bg-red-400'
                    : 'bg-secondary text-muted-foreground cursor-not-allowed'
                }`}
              >
                {declineMutation.isPending ? 'Declining…' : 'Decline Driver'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={danger ? 'text-red-400 font-medium' : 'text-white'}>{value}</span>
    </div>
  );
}

function DocStatusIcon({ status }: { status: string }) {
  if (status === 'approved') return <CheckCircle className="w-4 h-4 text-teal-400 flex-shrink-0" />;
  if (status === 'rejected') return <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />;
  return <Clock className="w-4 h-4 text-yellow-400 flex-shrink-0" />;
}

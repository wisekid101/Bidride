'use client';

import { Activity } from 'lucide-react';
import { BriefPage } from '../brief-page';

export default function MarketplaceHealthPage() {
  return <BriefPage type="marketplace_health" title="Marketplace Health" icon={<Activity className="w-6 h-6 text-teal-400" />} />;
}

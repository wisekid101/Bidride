'use client';

import { Map } from 'lucide-react';
import { BriefPage } from '../brief-page';

export default function MoneyMapPage() {
  return <BriefPage type="money_map" title="Money Map" icon={<Map className="w-6 h-6 text-teal-400" />} />;
}

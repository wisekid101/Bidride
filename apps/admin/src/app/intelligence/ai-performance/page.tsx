'use client';

import { Gauge } from 'lucide-react';
import { BriefPage } from '../brief-page';

export default function AiPerformancePage() {
  return <BriefPage type="ai_performance" title="AI Performance" icon={<Gauge className="w-6 h-6 text-purple-400" />} />;
}

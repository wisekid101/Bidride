'use client';

import { Crosshair } from 'lucide-react';
import { BriefPage } from '../brief-page';

export default function FocusPage() {
  return <BriefPage type="focus" title="Weekly Focus" icon={<Crosshair className="w-6 h-6 text-teal-300" />} />;
}

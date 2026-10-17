'use client';
import { USE_MOCKS } from '@/lib/api';
import { MockTutoring } from '@/components/tutoring/MockTutoring';
import { LiveTutoring } from '@/components/tutoring/LiveTutoring';

export default function Tutoring() {
  return USE_MOCKS ? <MockTutoring /> : <LiveTutoring />;
}

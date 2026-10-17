import { EmptyState, PillLink } from '@/components/ui';

export default function NotFound() {
  return <EmptyState emoji="🧭" line="That page fumbled. Let's get you back to campus." action={<PillLink href="/feed" size="sm">Browse Handoff</PillLink>} />;
}

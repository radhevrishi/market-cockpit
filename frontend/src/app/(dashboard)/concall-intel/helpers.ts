// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { TF } from './constants';

export function velocityColor(v: string): string {
  return v === 'Very fast' ? TF.green : v === 'Fast' ? '#34D399' : v === 'Medium' ? TF.amber : v === 'Slow' ? TF.saffron : TF.dim;
}

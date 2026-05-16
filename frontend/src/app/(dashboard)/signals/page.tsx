// PATCH 0441 BUG-018 — Add /signals as the canonical URL for what was
// previously /orders (semantically misleading — the page does corporate
// signal intelligence, not order management). /orders still works
// (existing bookmarks unbroken); /signals is the new preferred slug.
import { redirect } from 'next/navigation';

export default function SignalsRedirect() {
  redirect('/orders');
}

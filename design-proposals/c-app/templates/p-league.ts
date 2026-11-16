import { html } from '../../_build/lib.ts';
import { doc } from './layout.ts';
const stub = (t: string) => () => doc({ title: t, body: html`<div class="page"><p>À venir</p></div>` });
export const leadersPage = stub('Leaders');
export const awardsPage = stub('Récompenses');
export const rulesPage = stub('Règlement');
export const recruitmentPage = stub('Recrutement');
export const workspacePage = stub('Espace');
export const staffPage = stub('Staff');

import { build, TEMPLATES } from 'file:///D:/Ryagram-scratch/CONNECT/L-Ai-node-app/supabase/functions/_shared/templates.ts';
const t = TEMPLATES[0];
console.log(JSON.stringify({ template: t.id, dataset: t.datasets[0], story: build(t.id, t.datasets[0], 'Test headline') }));

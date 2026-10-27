// Makes a SAMPLE public film page's data from a real receipt, through the SAME allowlist the live film-page function uses (summarize), so the sample can
// only say what a real published page could say. Usage:
//   node tools/make-film-sample.mjs <receipt.json> <story.json> <out.json> "<page title>"
// The receipt itself is NOT copied anywhere: only the allowlisted summary is written (no machine paths, no cache fingerprints, no commands).
import fs from 'node:fs';
import { summarize } from '../supabase/functions/film-page/summary.ts';

const [receiptPath, storyPath, outPath, title] = process.argv.slice(2);
if (!receiptPath || !storyPath || !outPath || !title) { console.error('usage: node tools/make-film-sample.mjs <receipt.json> <story.json> <out.json> "<title>"'); process.exit(2); }
const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
const story = JSON.parse(fs.readFileSync(storyPath, 'utf8'));
const summary = summarize(receipt, story, { uploaded: false });
// A SAMPLE page: no publish date, the film's last frame as the poster (no video file: the film is still in review), and a link to the live preview.
const page = { sample: true, title, summary, published_at: null, video_url: null, poster_url: '/film/samples/interstate-final-frame.jpg', preview_url: '/preview-demo/' };
fs.writeFileSync(outPath, JSON.stringify(page, null, 2) + '\n');
console.log(`wrote ${outPath}: ${summary.datasets.length} dataset(s), ${summary.datasets.reduce((n, d) => n + d.sources.length, 0)} source(s), ${summary.measures.length} measure(s)`);

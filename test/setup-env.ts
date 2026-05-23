import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Load .env.test FIRST so values land in process.env before any module reads them.
// `override: true` means: if same var also exists in .env, the test value wins.
dotenv.config({ path: resolve(__dirname, '../.env.test'), override: true });

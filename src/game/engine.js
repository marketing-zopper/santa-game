// The deterministic game engine (rules, constants, seeded RNG, replay) lives in ONE file that both the game and the
// server-side score validator import, so the two can never drift apart.
export * from '../../supabase/functions/_shared/engine.js';

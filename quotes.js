export const QUOTES = [
  { id: 'q001', text: 'Small steps still move you forward.', author: 'D-Shift' },
  { id: 'q002', text: 'Your shift can be demanding. Your next choice can still be strong.', author: 'D-Shift' },
  { id: 'q003', text: 'Consistency beats intensity when life gets busy.', author: 'D-Shift' },
  { id: 'q004', text: 'Train the day you have, not the day you wish you had.', author: 'D-Shift' },
  { id: 'q005', text: 'Recovery is part of the work.', author: 'D-Shift' },
  { id: 'q006', text: 'One good meal, one good set, one good decision at a time.', author: 'D-Shift' },
  { id: 'q007', text: 'You do not need a perfect week to build a stronger one.', author: 'D-Shift' },
  { id: 'q008', text: 'Show up gently when energy is low. It still counts.', author: 'D-Shift' },
  { id: 'q009', text: 'Make today useful, even if it is not easy.', author: 'D-Shift' },
  { id: 'q010', text: 'Your future self benefits from what you do today.', author: 'D-Shift' },
  { id: 'q011', text: 'Strong habits fit around real life.', author: 'D-Shift' },
  { id: 'q012', text: 'Progress is built in ordinary moments.', author: 'D-Shift' }
];

export function getDailyQuote(localDate) {
  const digits = String(localDate).replace(/\D/g, '');
  const hash = [...digits].reduce((total, digit, index) => total + Number(digit) * (index + 1), 0);
  return QUOTES[hash % QUOTES.length];
}

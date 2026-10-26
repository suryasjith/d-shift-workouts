---
name: D-Shift Beta Testing
description: Run a human-style beta review of D-Shift Workouts with five parallel reviewers and ten varied user personas each
---

# D-Shift Beta Testing

Use this skill when the user asks to beta test, stress test, review, or validate D-Shift Workouts as a customer would use it.

## Required test model

Run exactly five independent reviewers in parallel. Each reviewer tests ten isolated user personas, for a total of fifty personas. Do not let test data leak between personas: use a fresh browser context or clear IndexedDB for each user.

Each persona must vary at least height, weight, goal, fatigue, rota anchor, and one future shift override. Across all personas, cover 4-on/3-off patterns and work/off-day routing.

## Every-persona journey

1. Set up the profile and confirm the Today dashboard renders.
2. Change fatigue and verify workout volume routing.
3. Visit Workout, edit the rota, keep the accordion open, start a session, enter weight and reps for every set one character at a time, add a set, swap an exercise, and save.
4. Visit Fuel, type a food query one character at a time without losing focus, verify dropdown results, select a result, add it, check macros, hydrate, and clear the daily fields.
5. Visit Progress, log a weigh-in, verify the moving-average view, log Swimming, Running, or Walking, and check activity calories.
6. Check the help modal, navigation, empty states, keyboard/tap behavior, mobile overflow, and offline shell.

## Review output

Report:

- Persona count and journeys completed
- Pass/fail summary by tab
- Reproduction steps for every failure
- Severity: blocker, critical, major, minor, or polish
- Browser console/page errors
- Accessibility and mobile usability findings
- Beta readiness verdict and recommended fixes

Do not edit application files during review. Fixes happen only after the review evidence is collected.

# User Discovery Playbook

This is how we find the right people.

We are not starting from scratch. We already use a working solution to identify the users we want to reach, and this is the process we use to keep that signal clean, fast, and repeatable.

We start with a target profile: accounts that match the right niche, audience, and engagement patterns. Then we pull the relevant profiles, filter out the noise, and keep only the creators who actually fit the motion.

The goal is simple:
- find the right users fast
- remove the junk
- keep the pipeline moving
- turn discovery into action

This is a discovery layer built around a real source of truth we already trust. We use it to find people who are already in the lane, then push them into the outreach flow.

No guessing. No random scraping. No dead-end lists.

Just the right users, the right time, the right move.

# Opportunity-Direct Prospecting

This system is built to go straight into our live opportunities and find prospects there.

We are not searching random internet noise. We are targeting the exact opportunity URLs already in play, then mining those pages for the right people to reach.

The flow is simple:
- keep each target in its own env variable such as `OPP1_URL`, `OPP2_URL`, `OPP3_URL`
- create a numbered opportunity folder such as `OPP1`, `OPP2`, `OPP3`
- place each strategy under that opp folder, e.g. `OPP1/strat-1`, `OPP1/strat-2`
- resolve the correct implementation by the env URL, not by a human-readable name
- scrape and normalize prospects from that specific opportunity, then send them into the outbound flow

This is direct-to-opportunity prospecting.

No generic discovery.
No name-based assumptions.
No soft targeting.

We operate against the real opportunity sources we already trust, and we find the right prospects there.

// Illustrative quests and forest for people who are signed out or can't
// reach the backend. Shown with a "Sample" banner; never mixed with real data.

export function sampleQuests() {
  return {
    week_start: new Date().toISOString().slice(0, 10),
    quests: [
      {
        id: "sample-1", slot: 1, quest_type: "talk", level: 2, target: 3, progress: 3,
        reward_acorns: 40, status: "active", complete: true, claimable: true,
        title: "Talk to Pip before 3 checkouts",
        hint: "Every conversation with Pip counts, whatever you decide.",
      },
      {
        id: "sample-2", slot: 2, quest_type: "follow", level: 1, target: 1, progress: 1,
        reward_acorns: 30, status: "claimed", complete: true, claimable: false,
        title: "Follow Pip's advice 1 time",
        hint: "Do what Pip suggests: buy, save for later or skip.",
      },
      {
        id: "sample-3", slot: 3, quest_type: "kept", level: 2, target: 20, progress: 12.5,
        reward_acorns: 40, status: "active", complete: false, claimable: false,
        title: "Keep $20 from impulse buys",
        hint: "Carts you skip add up toward this.",
      },
    ],
  };
}

export function sampleForest() {
  return {
    trees: 47, forests: 1, trees_in_current_forest: 17, trees_per_forest: 30,
    tree_cost: 100, dollars_pledged: 5, dollars_per_forest: 5, acorn_balance: 240,
  };
}

export function sampleLeaderboard() {
  const top = [
    ["Maya R.", 96], ["Jordan T.", 71], ["You", 47], ["Sam L.", 33], ["Priya S.", 28],
    ["Alex M.", 19], ["Chris D.", 12], ["Nora K.", 8],
  ].map(([display_name, trees], i) => ({
    rank: i + 1, display_name, trees, forests: Math.floor(trees / 30), is_you: display_name === "You",
  }));
  return { top, you: top[2] };
}

# Changelog

## 1.1.0 — November 2026

### Fixed
- "Add item", "Drinks" and the goal editor showed even when they were meant to be hidden.
- Progress could read more than 100% after removing or replacing items.
- The streak dropped to 0 every morning until that day's list was finished.
- Drinks were compared with the *weekly* target using only *today's* count.
- Leaving the app open past midnight recorded ticks against the previous day.
- Weight-gain goals showed 0 to go, no progress and "kg lost".
- Text from AI plans and from your own edits was inserted into the page unescaped.
- A malformed AI plan or damaged saved data could stop the app from opening, with no way to recover.
- Blocks longer than about 45 days drew an empty progress strip.
- The Plan tab always showed Monday's meals.
- Renaming a meal item replaced it for every day of the week. Meals are now edited in the Plan tab.
- Applying a new plan wiped all progress without asking.
- Installed apps could stay on an old version until a cache number was changed by hand.
- The server accepted any text in the diet, goal and activity fields, sent the API key in the URL, and returned raw upstream errors to the browser.
- Weights of exactly 30 kg were accepted by the form and rejected by the server.

### Added
- Back up, restore and reset.
- "Start a new block" when a block ends.
- Offline indicator and clear messages when plan building isn't available.
- Install hint for iPhone, and a way to dismiss the install bar.
- Weight chart labels, with spacing that reflects real dates.
- Keyboard support for tabs and dialogs; labels for screen readers.
- New two-row logo (two weeks of seven days) and matching app icons.
- Tests for the server function.

### Changed
- "AI plan setup" (⚙) is now a "New plan" button; the wizard no longer names the AI vendor.
- README rewritten; `START-HERE.md` removed because it described files and code that no longer exist.

## 1.0.0 — September 2026
First version: tracker, weight log, AI plan wizard, offline support.

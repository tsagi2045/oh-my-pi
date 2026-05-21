/**
 * One-shot notification demo. Fires the two toast shapes OMP will emit in
 * the user's real ghostty + tmux + macOS workflow:
 *
 *   1. "Task complete"   — body = a representative agent answer excerpt.
 *   2. "Awaiting input"  — body = a representative `ask` question.
 *
 * Both go through the alerter path (delivery="alerter") so click-jump works
 * — clicking either toast should activate Ghostty, jump tmux to this pane,
 * and flash the pane background once in colour67. The two toasts use
 * distinct group keys so macOS Notification Center retains both.
 *
 * Run from the repo root:   bun run notify-demo.ts
 */
import {
	composeNotificationSubtitle,
	getTmuxContext,
	setNotificationDelivery,
	TERMINAL,
} from "@oh-my-pi/pi-tui";

setNotificationDelivery("alerter");

const tmux = getTmuxContext();
const subtitle = composeNotificationSubtitle(tmux, "Ghostty tmux Oh-My-Posh 알림 설정");
const macAppName = TERMINAL.macAppName;
const onClick = tmux && macAppName ? { ...tmux, terminalApp: macAppName } : tmux;

console.log("Detected outer terminal app:", TERMINAL.macAppName ?? "(unknown)");
console.log("tmux focus context:", tmux);
console.log("subtitle:", subtitle);
console.log("delivery override: alerter");
console.log("");

// 1. Task complete — long body to exercise the 200-char limit.
const taskBody =
	"알림 시스템 개편 완료. notify.delivery=alerter 경로로 토스트를 발사했고, 클릭 시 Ghostty 활성화 → tmux pane 점프 → 배경 1회 colour67 깜빡임이 동작해야 합니다. 이 토스트를 한번 클릭해서 확인해주세요.";

TERMINAL.sendNotification({
	title: "Task complete",
	subtitle,
	body: taskBody,
	group: "omp-stop-demo",
	onClick,
});

console.log("→ Fired toast #1: Task complete");

// Wait briefly so the two toasts are visually distinct in the upper-right
// stack (macOS otherwise replaces one with the next within ~100ms).
await new Promise((r) => setTimeout(r, 2000));

// 2. Awaiting input — feeds the `ask` shape.
const askBody =
	"클릭하면 이 pane으로 돌아오면서 배경이 한 번 부드럽게 깜빡거리는지 확인해주세요. 분할된 pane이라면 정확히 이 pane만 깜빡거려야 합니다.";

TERMINAL.sendNotification({
	title: "Awaiting input",
	subtitle,
	body: askBody,
	group: "omp-ask-demo",
	onClick,
});

console.log("→ Fired toast #2: Awaiting input");
console.log("");
console.log("Both toasts dispatched. Check upper-right of the screen, then Notification Center.");
console.log("Clicking either should activate Ghostty + jump this tmux pane + flash bg once.");

// Give the detached alerter children time to actually surface the toast
// before the parent process exits. The wrapper backgrounds + disowns alerter
// so this delay isn't strictly required for delivery, but it makes the demo
// feel less abrupt in the terminal.
await new Promise((r) => setTimeout(r, 500));

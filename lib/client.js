window.__ModuleLoader__.load({
	id: "dsh-restart-button",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const react = require("react");
		const { jsx, jsxs, Fragment } = require("react/jsx-runtime");
		const reactDom = require("react-dom");
		const ui = require("@deepseek-ai/dsh-client-ui-primitives");

		//#region constants
		const PLUGIN_ID = "dsh-restart-button";
		/** Locale namespace owned by this plugin. */
		const NS = "restart-button";
		/** Document-relative Host routes (the shell serves the GUI with `<base href="./">`). */
		const STATUS_ROUTE = "api/restart-button.status";
		const RESTART_ROUTE = "api/restart-button.restart";
		//#endregion

		//#region styles
		const css = [
			".dshRestartButton{width:28px;padding:0;flex:none;color:var(--dsw-alias-label-secondary)}",
			".dshRestartButton svg{width:15px;height:15px}",
			".dshRestartButton[data-busy=true] svg{animation:dshRestartSpin .9s linear infinite}",
			"@keyframes dshRestartSpin{to{transform:rotate(360deg)}}",
			".dshRestartOverlay{position:fixed;inset:var(--dsh-frame-chrome-top,0px) 0 0;z-index:2147483000;display:flex;align-items:center;justify-content:center;pointer-events:auto;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.45));backdrop-filter:var(--dsw-mask-blur,blur(2px))}",
			".dshRestartCard{box-sizing:border-box;display:flex;flex-direction:column;align-items:center;gap:12px;min-width:300px;max-width:420px;padding:28px 32px;border-radius:var(--dsw-radius-panel,16px);background:var(--dsw-alias-bg-layer-2,#222);box-shadow:var(--dsw-elevation-prominent,0 12px 40px rgba(0,0,0,.35));color:var(--dsw-alias-label-primary,#fff);text-align:center;font-family:var(--dsw-font-family,inherit)}",
			".dshRestartRing{width:30px;height:30px;box-sizing:border-box;border-radius:50%;border:2.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));border-top-color:var(--dsw-alias-brand-primary,#4d6bfe);animation:dshRestartSpin .9s linear infinite}",
			".dshRestartTitle{font-size:16px;line-height:24px;font-weight:500}",
			".dshRestartText{font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary,#aaa)}",
			".dshRestartWarn{display:flex;gap:8px;align-items:flex-start;font-size:13px;line-height:20px;color:var(--dsw-alias-state-warn-primary,#e8a33d)}",
			".dshRestartWarn svg{flex:none;margin-top:1px}",
			".dshRestartLog{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#aaa);word-break:break-all;user-select:text}",
			"@media (prefers-reduced-motion:reduce){.dshRestartRing,.dshRestartButton[data-busy=true] svg{animation-duration:2.4s}}"
		].join("");
		const tagId = "dsh-restart-button/client.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = PLUGIN_ID;
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		//#endregion

		//#region locales
		const zh = {
			"button.label": "重启客户端",
			"button.tooltip": "重启 DeepSeek Harness",
			"confirm.title": "重启 DeepSeek Harness？",
			"confirm.idle": "将保存会话并重新启动整个客户端（包括后台 Host）。",
			"confirm.busy": "当前有正在运行的任务或后台作业，重启会中断它们。会话记录会保留，重启后可以继续。",
			"confirm.always": "将保存会话并重新启动整个客户端（包括后台 Host）。",
			"confirm.cancel": "取消",
			"confirm.ok": "立即重启",
			"dialog.close": "关闭",
			"overlay.title": "正在重启 DeepSeek Harness…",
			"overlay.desktop": "正在保存会话并关闭客户端，新窗口稍后会自动打开。",
			"overlay.web": "正在重启 DSH 服务，完成后页面会自动刷新。",
			"error.title": "重启失败",
			"error.unsupported": "当前运行环境不支持一键重启（仅支持 Windows 桌面版和 dsh web）。",
			"error.timeout": "重启没有在预期时间内完成。",
			"error.status": "无法读取重启插件的状态：",
			"error.request": "重启请求失败：",
			"error.failed": "重启助手报告失败：",
			"error.log": "详细日志："
		};
		const en = {
			"button.label": "Restart client",
			"button.tooltip": "Restart DeepSeek Harness",
			"confirm.title": "Restart DeepSeek Harness?",
			"confirm.idle": "Sessions are saved and the whole client (including the background Host) starts again.",
			"confirm.busy": "Tasks or background jobs are running and will be interrupted. Session history is kept, so you can continue after the restart.",
			"confirm.always": "Sessions are saved and the whole client (including the background Host) starts again.",
			"confirm.cancel": "Cancel",
			"confirm.ok": "Restart now",
			"dialog.close": "Close",
			"overlay.title": "Restarting DeepSeek Harness…",
			"overlay.desktop": "Saving sessions and closing the client. A new window opens shortly.",
			"overlay.web": "Restarting the DSH server. This page reloads when it is back.",
			"error.title": "Restart failed",
			"error.unsupported": "One-click restart is not available in this runtime (Windows desktop app and dsh web only).",
			"error.timeout": "The restart did not finish in time.",
			"error.status": "Could not read the restart plugin status: ",
			"error.request": "The restart request failed: ",
			"error.failed": "The restart helper reported a failure: ",
			"error.log": "Log file: "
		};
		//#endregion

		//#region controller
		const BUSY = new Set(["checking", "requesting", "restarting"]);
		const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
		function messageOf(error) {
			if (error && error.name === "AbortError") return "timeout";
			return error instanceof Error ? error.message : String(error);
		}
		async function fetchJson(url, init, timeoutMs) {
			const abort = new AbortController();
			const timer = setTimeout(() => abort.abort(), timeoutMs);
			try {
				const response = await fetch(url, { cache: "no-store", credentials: "same-origin", ...init, signal: abort.signal });
				let body = null;
				try {
					body = await response.json();
				} catch {}
				return { ok: response.ok, status: response.status, body };
			} finally {
				clearTimeout(timer);
			}
		}
		async function fetchStatus(timeoutMs) {
			const result = await fetchJson(STATUS_ROUTE, {}, timeoutMs);
			if (!result.ok || result.body === null || result.body.ok !== true) throw new Error(result.body?.error ?? `HTTP ${result.status}`);
			return result.body;
		}
		/** Reload without letting page-level beforeunload prompts block the fresh server. */
		function reloadPage() {
			window.addEventListener("beforeunload", (event) => {
				event.stopImmediatePropagation();
			}, { capture: true });
			window.location.reload();
		}
		/**
		 * One restart flow per page, shared by every header button and the overlay layer.
		 * Phases: idle → checking → (confirm →) requesting → restarting, or error.
		 */
		function createRestartController() {
			let state = { phase: "idle", status: null, statusFailed: false, mode: null, error: null, logFile: null };
			const listeners = new Set();
			let disposed = false;
			let watchTimer;
			const set = (patch) => {
				if (disposed) return;
				state = { ...state, ...patch };
				for (const listener of [...listeners]) try {
					listener();
				} catch (error) {
					console.error(error);
				}
			};
			const failWith = (code, message, logFile) => set({ phase: "error", error: { code, message: message ?? "" }, ...logFile ? { logFile } : {} });
			const watch = (bootId, mode) => {
				const started = Date.now();
				const limit = mode === "web" ? 180000 : 60000;
				const tick = async () => {
					if (disposed) return;
					let status = null;
					try {
						status = await fetchStatus(4000);
					} catch {}
					if (disposed) return;
					if (status !== null && status.bootId !== bootId) {
						reloadPage();
						return;
					}
					if (status !== null && status.restart && status.restart.state === "failed") {
						failWith("failed", status.restart.error, status.logFile);
						return;
					}
					if (Date.now() - started > limit) {
						failWith("timeout", "");
						return;
					}
					watchTimer = setTimeout(tick, 1500);
				};
				watchTimer = setTimeout(tick, 2500);
			};
			const restart = async () => {
				set({ phase: "requesting" });
				const before = state.status;
				let result;
				try {
					result = await fetchJson(RESTART_ROUTE, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ source: "header-button" })
					}, 45000);
				} catch (error) {
					failWith("request", messageOf(error));
					return;
				}
				if (!result.ok || result.body === null || result.body.ok !== true) {
					failWith("request", result.body?.error ?? `HTTP ${result.status}`, result.body?.logFile);
					return;
				}
				set({ phase: "restarting", mode: result.body.mode, logFile: result.body.logFile ?? state.logFile });
				watch(before?.bootId ?? result.body.bootId, result.body.mode);
			};
			return {
				subscribe: (listener) => {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
				getSnapshot: () => state,
				/** Learn once whether this runtime supports restarting (hides the button otherwise). */
				refresh: async () => {
					for (let attempt = 0; attempt < 4 && !disposed; attempt++) {
						try {
							const status = await fetchStatus(8000);
							set({ status, statusFailed: false, logFile: status.logFile });
							return;
						} catch {
							await delay(1500 * (attempt + 1));
						}
					}
					set({ statusFailed: true });
				},
				/** Button press: check the Host, ask only when the policy requires it, then restart. */
				request: async () => {
					if (BUSY.has(state.phase) || state.phase === "confirm") return;
					set({ phase: "checking", error: null });
					let status;
					try {
						status = await fetchStatus(8000);
					} catch (error) {
						failWith("status", messageOf(error));
						return;
					}
					set({ status, statusFailed: false, logFile: status.logFile });
					if (!status.supported) {
						failWith("unsupported", "");
						return;
					}
					if (status.restart && (status.restart.state === "pending" || status.restart.state === "handoff")) {
						set({ phase: "restarting", mode: status.mode });
						watch(status.bootId, status.mode);
						return;
					}
					const ask = status.confirm === "always" || status.confirm !== "never" && status.activeTasks === true;
					if (ask) set({ phase: "confirm" });
					else await restart();
				},
				confirm: () => {
					if (state.phase === "confirm") restart();
				},
				cancel: () => {
					if (state.phase === "confirm") set({ phase: "idle" });
				},
				dismiss: () => {
					if (state.phase === "error") set({ phase: "idle", error: null });
				},
				dispose: () => {
					disposed = true;
					clearTimeout(watchTimer);
					listeners.clear();
				}
			};
		}
		//#endregion

		//#region components
		function useController(controller) {
			return react.useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
		}
		/** Icon button in the Session header's right-aligned utilities. */
		function RestartHeaderButton({ controller, t }) {
			const state = useController(controller);
			if (state.status !== null && state.status.supported === false) return null;
			if (state.status === null && state.statusFailed) return null;
			const busy = BUSY.has(state.phase);
			const label = t("button.tooltip");
			return jsx(ui.Tooltip, {
				label,
				side: "bottom",
				delayMs: 400,
				portal: true,
				children: jsx(ui.Button, {
					size: "sm",
					className: "dshRestartButton",
					"data-dsh-restart-button": "",
					"data-busy": busy ? "true" : void 0,
					"aria-label": t("button.label"),
					"aria-busy": busy,
					disabled: busy,
					onClick: () => {
						controller.request();
					},
					children: jsx(ui.IconRefreshOutlineRegular, { size: 15 })
				})
			});
		}
		function errorText(error, t) {
			if (error === null) return "";
			switch (error.code) {
				case "unsupported": return t("error.unsupported");
				case "timeout": return t("error.timeout");
				case "status": return t("error.status") + error.message;
				case "failed": return t("error.failed") + error.message;
				default: return t("error.request") + error.message;
			}
		}
		/** Frame-wide layer: confirmation, failure dialog, and the restarting cover. */
		function RestartLayer({ controller, t }) {
			const state = useController(controller);
			const busyTasks = state.status?.activeTasks === true;
			const restarting = state.phase === "restarting" || state.phase === "requesting";
			return jsxs(Fragment, { children: [
				jsx(ui.Modal, {
					open: state.phase === "confirm",
					onClose: controller.cancel,
					title: t("confirm.title"),
					closeLabel: t("dialog.close"),
					description: busyTasks ? void 0 : t(state.status?.confirm === "always" ? "confirm.always" : "confirm.idle"),
					children: busyTasks ? jsxs("div", {
						className: "dshRestartWarn",
						children: [jsx(ui.IconWarningOutlineRegular, { size: 16 }), jsx("span", { children: t("confirm.busy") })]
					}) : void 0,
					footer: jsxs(Fragment, { children: [jsx(ui.Button, {
						variant: "outline",
						onClick: controller.cancel,
						children: t("confirm.cancel")
					}), jsx(ui.Button, {
						variant: "primary",
						"data-modal-autofocus": true,
						onClick: controller.confirm,
						children: t("confirm.ok")
					})] })
				}),
				jsx(ui.Modal, {
					open: state.phase === "error",
					onClose: controller.dismiss,
					title: t("error.title"),
					closeLabel: t("dialog.close"),
					description: errorText(state.error, t),
					children: state.logFile ? jsxs("div", {
						className: "dshRestartLog",
						children: [t("error.log"), state.logFile]
					}) : void 0,
					footer: jsx(ui.Button, {
						variant: "primary",
						onClick: controller.dismiss,
						children: t("dialog.close")
					})
				}),
				restarting && state.phase === "restarting" ? reactDom.createPortal(jsx("div", {
					className: "dshRestartOverlay",
					role: "alertdialog",
					"aria-live": "assertive",
					"aria-label": t("overlay.title"),
					"data-dsh-restart-overlay": "",
					children: jsxs("div", {
						className: "dshRestartCard",
						children: [
							jsx("div", { className: "dshRestartRing", "aria-hidden": true }),
							jsx("div", { className: "dshRestartTitle", children: t("overlay.title") }),
							jsx("div", { className: "dshRestartText", children: t(state.mode === "web" ? "overlay.web" : "overlay.desktop") })
						]
					})
				}), document.body) : null
			] });
		}
		//#endregion

		//#region plugin
		/** Browser services this plugin needs. */
		const inject = ["slots", "locale"];
		/**
		 * Mount the restart button into the Session header utilities (right-aligned, after
		 * the shipped utilities) and the shared dialogs into the frame overlay.
		 * @param ctx - browser plugin context carrying slots and locale.
		 */
		function apply(ctx) {
			const controller = createRestartController();
			ctx.effect(() => () => {
				controller.dispose();
			}, "restart-button: controller");
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "restart-button: dictionaries");
			const fallbackT = ctx.locale.bind(NS);
			controller.refresh();
			ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
				name: "conversation.session.header.utilities",
				id: "restart-button",
				order: 1000,
				label: () => fallbackT("button.label"),
				locale: NS,
				registrant: PLUGIN_ID
			}, (props) => jsx(RestartHeaderButton, { controller, t: props.t ?? fallbackT })));
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "restart-button",
				order: 1000,
				locale: NS,
				registrant: PLUGIN_ID
			}, (props) => jsx(RestartLayer, { controller, t: props.t ?? fallbackT })));
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

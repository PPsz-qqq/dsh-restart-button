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
		const ROUTES = {
			status: "api/restart-button.status",
			restart: "api/restart-button.restart",
			cancel: "api/restart-button.cancel",
			resumeAck: "api/restart-button.resume-ack"
		};
		const POLL_IDLE_MS = 60000;
		const POLL_SCHEDULED_MS = 1000;
		const HOVER_REFRESH_MS = 5000;
		const DISMISSED_PLUGINS_KEY = "dsh-restart-button:dismissed-plugins";
		const HANDLED_RESUME_KEY = "dsh-restart-button:handled-resume";
		//#endregion

		//#region styles
		const css = [
			".dshRestartButton{position:relative;width:28px;padding:0;flex:none;color:var(--dsw-alias-label-secondary)}",
			".dshRestartButton svg{width:15px;height:15px}",
			".dshRestartButton[data-busy=true] svg{animation:dshRestartSpin .9s linear infinite}",
			".dshRestartButton[data-scheduled=true]{color:var(--dsw-alias-brand-primary,#4d6bfe)}",
			".dshRestartBadge{position:absolute;top:4px;right:4px;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-warn-primary,#e8a33d);pointer-events:none}",
			".dshRestartBadge[data-kind=scheduled]{background:var(--dsw-alias-brand-primary,#4d6bfe);animation:dshRestartPulse 1.6s ease-in-out infinite}",
			"@keyframes dshRestartSpin{to{transform:rotate(360deg)}}",
			"@keyframes dshRestartPulse{50%{opacity:.3}}",
			"@keyframes dshRestartIn{from{opacity:0;transform:translateY(-4px)}}",
			".dshRestartOverlay{position:fixed;inset:var(--dsh-frame-chrome-top,0px) 0 0;z-index:2147483000;display:flex;align-items:center;justify-content:center;pointer-events:auto;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.45));backdrop-filter:var(--dsw-mask-blur,blur(2px))}",
			".dshRestartCard{box-sizing:border-box;display:flex;flex-direction:column;align-items:center;gap:12px;min-width:300px;max-width:420px;padding:28px 32px;border-radius:var(--dsw-radius-panel,16px);background:var(--dsw-alias-bg-layer-2,#222);box-shadow:var(--dsw-elevation-prominent,0 12px 40px rgba(0,0,0,.35));color:var(--dsw-alias-label-primary,#fff);text-align:center;font-family:var(--dsw-font-family,inherit)}",
			".dshRestartRing{width:30px;height:30px;box-sizing:border-box;border-radius:50%;border:2.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));border-top-color:var(--dsw-alias-brand-primary,#4d6bfe);animation:dshRestartSpin .9s linear infinite}",
			".dshRestartTitle{font-size:16px;line-height:24px;font-weight:500}",
			".dshRestartText{font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary,#aaa)}",
			".dshRestartWarn{display:flex;gap:8px;align-items:flex-start;font-size:13px;line-height:20px;color:var(--dsw-alias-state-warn-primary,#e8a33d)}",
			".dshRestartWarn svg{flex:none;margin-top:2px}",
			".dshRestartWarnNames{display:block;margin-top:2px;color:var(--dsw-alias-label-secondary,#aaa)}",
			".dshRestartLog{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#aaa);word-break:break-all;user-select:text}",
			".dshRestartNotices{position:fixed;top:calc(var(--dsh-frame-chrome-top,0px) + 60px);right:16px;z-index:1050;display:flex;flex-direction:column;gap:10px;width:340px;max-width:calc(100vw - 32px);pointer-events:none}",
			".dshRestartNotice{pointer-events:auto;box-sizing:border-box;padding:14px 16px;border-radius:var(--dsw-radius-md,12px);background:var(--dsw-alias-bg-overlay,#2a2a2a);border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));box-shadow:var(--dsw-elevation-prominent,0 8px 30px rgba(0,0,0,.3));color:var(--dsw-alias-label-primary,#fff);font-size:13px;line-height:20px;font-family:var(--dsw-font-family,inherit);animation:dshRestartIn .18s ease-out}",
			".dshRestartNoticeTitle{font-size:14px;font-weight:500;margin-bottom:4px}",
			".dshRestartNoticeText{color:var(--dsw-alias-label-secondary,#aaa)}",
			".dshRestartNoticeList{margin:6px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:2px;min-width:0}",
			".dshRestartNoticeList li{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".dshRestartLink{all:unset;cursor:pointer;color:var(--dsw-alias-brand-primary,#4d6bfe)}",
			".dshRestartLink:hover{text-decoration:underline}",
			".dshRestartLink:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:2px;border-radius:2px}",
			".dshRestartNoticeError{margin-top:6px;color:var(--dsw-alias-state-error-primary,#e5484d)}",
			".dshRestartNoticeActions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}",
			"@media (prefers-reduced-motion:reduce){.dshRestartRing,.dshRestartButton[data-busy=true] svg{animation-duration:2.4s}.dshRestartBadge[data-kind=scheduled],.dshRestartNotice{animation:none}}"
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
			"tooltip.runtime": "已运行 {uptime} · Host 内存 {memory}",
			"tooltip.busy": "{count} 个会话正在运行",
			"tooltip.busyJobs": "有后台作业正在运行",
			"tooltip.scheduled": "已安排：任务完成后自动重启（点击可取消）",
			"tooltip.pending": "{count} 个插件更新需重启生效",
			"duration.days": "{n} 天",
			"duration.hours": "{n} 小时",
			"duration.minutes": "{n} 分钟",
			"duration.lessMinute": "不到 1 分钟",
			"confirm.title": "重启 DeepSeek Harness？",
			"confirm.idle": "将保存会话并重新启动整个客户端（包括后台 Host）。",
			"confirm.always": "将保存会话并重新启动整个客户端（包括后台 Host）。",
			"confirm.busy": "{count} 个会话正在运行，立即重启会中断它们；也可以等它们跑完后自动重启。会话记录会保留。",
			"confirm.busyJobs": "有后台作业正在运行，立即重启会中断它们；也可以等它们完成后自动重启。",
			"confirm.busyNames": "正在运行：{names}",
			"list.separator": "、",
			"confirm.cancel": "取消",
			"confirm.whenIdle": "跑完后重启",
			"confirm.ok": "立即重启",
			"scheduled.title": "已安排重启",
			"scheduled.text": "所有正在运行的任务完成后，DeepSeek Harness 会自动重启，并回到当前会话。",
			"scheduled.cancel": "取消安排",
			"scheduled.now": "立即重启",
			"dialog.close": "关闭",
			"overlay.title": "正在重启 DeepSeek Harness…",
			"overlay.desktop": "正在保存会话并关闭客户端，新窗口稍后会自动打开。",
			"overlay.web": "正在重启 DSH 服务，完成后页面会自动刷新。",
			"error.title": "重启失败",
			"error.unsupported": "当前运行环境不支持一键重启（仅支持 Windows 桌面版和 dsh web）。",
			"error.timeout": "重启没有在预期时间内完成。",
			"error.status": "无法读取重启插件的状态：",
			"error.request": "重启请求失败：",
			"error.cancel": "无法取消已安排的重启：",
			"error.failed": "重启助手报告失败：",
			"error.log": "详细日志：",
			"resume.title": "重启完成",
			"resume.text": "重启前有 {count} 个会话正在运行，已被中断：",
			"resume.untitled": "未命名会话",
			"resume.more": "等 {count} 个",
			"resume.continue": "全部继续",
			"resume.continuing": "正在继续…",
			"resume.dismiss": "忽略",
			"resume.continueFailed": "以下会话没能自动继续，请点开后手动发送。",
			"resume.prompt": "继续",
			"plugins.title": "插件更新待生效",
			"plugins.text": "以下插件已更新，重启后生效：",
			"plugins.more": "等 {count} 个",
			"plugins.later": "稍后",
			"plugins.restart": "立即重启"
		};
		const en = {
			"button.label": "Restart client",
			"button.tooltip": "Restart DeepSeek Harness",
			"tooltip.runtime": "Up {uptime} · Host memory {memory}",
			"tooltip.busy": "{count} session(s) running",
			"tooltip.busyJobs": "Background jobs are running",
			"tooltip.scheduled": "Scheduled: restarts when running work finishes (click to cancel)",
			"tooltip.pending": "{count} plugin update(s) take effect after a restart",
			"duration.days": "{n}d",
			"duration.hours": "{n}h",
			"duration.minutes": "{n}m",
			"duration.lessMinute": "under a minute",
			"confirm.title": "Restart DeepSeek Harness?",
			"confirm.idle": "Sessions are saved and the whole client (including the background Host) starts again.",
			"confirm.always": "Sessions are saved and the whole client (including the background Host) starts again.",
			"confirm.busy": "{count} session(s) are running and a restart now interrupts them; you can also restart automatically once they finish. Session history is kept.",
			"confirm.busyJobs": "Background jobs are running and a restart now interrupts them; you can also restart automatically once they finish.",
			"confirm.busyNames": "Running: {names}",
			"list.separator": ", ",
			"confirm.cancel": "Cancel",
			"confirm.whenIdle": "Restart when done",
			"confirm.ok": "Restart now",
			"scheduled.title": "Restart scheduled",
			"scheduled.text": "DeepSeek Harness restarts automatically once all running work finishes, and returns to this session.",
			"scheduled.cancel": "Cancel restart",
			"scheduled.now": "Restart now",
			"dialog.close": "Close",
			"overlay.title": "Restarting DeepSeek Harness…",
			"overlay.desktop": "Saving sessions and closing the client. A new window opens shortly.",
			"overlay.web": "Restarting the DSH server. This page reloads when it is back.",
			"error.title": "Restart failed",
			"error.unsupported": "One-click restart is not available in this runtime (Windows desktop app and dsh web only).",
			"error.timeout": "The restart did not finish in time.",
			"error.status": "Could not read the restart plugin status: ",
			"error.request": "The restart request failed: ",
			"error.cancel": "Could not cancel the scheduled restart: ",
			"error.failed": "The restart helper reported a failure: ",
			"error.log": "Log file: ",
			"resume.title": "Restart complete",
			"resume.text": "{count} session(s) were running before the restart and were interrupted:",
			"resume.untitled": "Untitled session",
			"resume.more": "and {count} more",
			"resume.continue": "Continue all",
			"resume.continuing": "Continuing…",
			"resume.dismiss": "Dismiss",
			"resume.continueFailed": "These sessions could not continue automatically; open them and send a message.",
			"resume.prompt": "Continue",
			"plugins.title": "Plugin updates pending",
			"plugins.text": "These plugins were updated and take effect after a restart:",
			"plugins.more": "and {count} more",
			"plugins.later": "Later",
			"plugins.restart": "Restart now"
		};
		//#endregion

		//#region helpers
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
		const postJson = (url, body, timeoutMs) => fetchJson(url, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body)
		}, timeoutMs);
		async function fetchStatus(timeoutMs) {
			const result = await fetchJson(ROUTES.status, {}, timeoutMs);
			if (!result.ok || result.body === null || result.body.ok !== true) throw new Error(result.body?.error ?? `HTTP ${result.status}`);
			return result.body;
		}
		function storageGet(storage, key) {
			try {
				return storage?.getItem(key) ?? null;
			} catch {
				return null;
			}
		}
		function storageSet(storage, key, value) {
			try {
				storage?.setItem(key, value);
			} catch {}
		}
		/** Reload without letting page-level beforeunload prompts block the fresh server. */
		function reloadPage() {
			window.addEventListener("beforeunload", (event) => {
				event.stopImmediatePropagation();
			}, { capture: true });
			window.location.reload();
		}
		/** Stable identity of a set of pending plugin updates, so "Later" silences exactly that set. */
		function pluginSignature(pending) {
			return (pending ?? []).map((item) => `${item.name}@${item.to}`).sort().join("|");
		}
		function formatDuration(seconds, t) {
			const total = Math.max(0, Math.floor(Number(seconds) || 0));
			if (total < 60) return t("duration.lessMinute");
			const days = Math.floor(total / 86400);
			const hours = Math.floor(total % 86400 / 3600);
			const minutes = Math.floor(total % 3600 / 60);
			const parts = [];
			if (days > 0) parts.push(t("duration.days", { n: String(days) }));
			if (hours > 0) parts.push(t("duration.hours", { n: String(hours) }));
			if (days === 0 && minutes > 0) parts.push(t("duration.minutes", { n: String(minutes) }));
			return parts.slice(0, 2).join(" ");
		}
		function formatBytes(bytes) {
			const value = Number(bytes) || 0;
			if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`;
			return `${Math.max(1, Math.round(value / 1024 ** 2))} MB`;
		}
		/** Multi-line tooltip: action, runtime facts, then whatever needs attention. */
		function tooltipText(state, t) {
			const status = state.status;
			const lines = [t("button.tooltip")];
			if (status?.runtime) lines.push(t("tooltip.runtime", {
				uptime: formatDuration(status.runtime.uptimeSec, t),
				memory: formatBytes(status.runtime.rssBytes)
			}));
			if (status?.scheduled) lines.push(t("tooltip.scheduled"));
			else if (status?.busySessions?.length > 0) lines.push(t("tooltip.busy", { count: String(status.busySessions.length) }));
			else if (status?.activeTasks) lines.push(t("tooltip.busyJobs"));
			if (status?.pendingPlugins?.length > 0) lines.push(t("tooltip.pending", { count: String(status.pendingPlugins.length) }));
			return lines.join("\n");
		}
		//#endregion

		//#region controller
		/**
		 * One restart flow per page, shared by every header button and the overlay layer.
		 * Phases: idle → checking → (confirm →) requesting → restarting, plus scheduledMenu and error.
		 * @param env - service lookup, the localized "continue" message, and storage seams.
		 */
		function createRestartController(env) {
			const local = env.localStorage;
			const session = env.sessionStorage;
			let state = {
				phase: "idle",
				status: null,
				statusFailed: false,
				mode: null,
				error: null,
				logFile: null,
				resume: null,
				pluginDismissed: storageGet(local, DISMISSED_PLUGINS_KEY)
			};
			const listeners = new Set();
			let disposed = false;
			let watchTimer;
			let pollTimer;
			let lastFetchAt = 0;
			let watching = false;
			const sessionsShown = [];
			const handledResume = new Set((storageGet(session, HANDLED_RESUME_KEY) ?? "").split(",").filter(Boolean));
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
			/** The Session in the main view (as the shipped workspace UI finds it), else the latest mounted header. */
			const currentSession = () => {
				try {
					const rows = Object.values(env.getService("sessions")?.list?.getSnapshot()?.byId ?? {});
					const main = rows.find((row) => (row?.retainedBy?.mainView ?? 0) > 0)?.id;
					if (typeof main === "string" && main !== "") return main;
				} catch {}
				return sessionsShown[sessionsShown.length - 1];
			};
			const openSession = async (id) => {
				for (let attempt = 0; attempt < 20 && !disposed; attempt++) {
					const workspace = env.getService("uiWorkspace");
					if (workspace !== void 0) {
						try {
							workspace.openSession(id);
						} catch (error) {
							console.warn("restart-button: could not open session", id, error);
						}
						return;
					}
					await delay(500);
				}
			};
			const ack = (id, action) => {
				postJson(ROUTES.resumeAck, { id, action }, 8000).catch(() => {});
			};
			const handleResume = (resume) => {
				if (handledResume.has(resume.id)) return;
				handledResume.add(resume.id);
				storageSet(session, HANDLED_RESUME_KEY, [...handledResume].join(","));
				if (resume.activeSessionId) openSession(resume.activeSessionId);
				if (resume.interrupted.length > 0) set({ resume: { id: resume.id, interrupted: resume.interrupted, busy: false, failed: false } });
				else ack(resume.id, "opened");
			};
			const watch = (bootId, mode) => {
				if (watching) return;
				watching = true;
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
						watching = false;
						failWith("failed", status.restart.error, status.logFile);
						return;
					}
					if (Date.now() - started > limit) {
						watching = false;
						failWith("timeout", "");
						return;
					}
					watchTimer = setTimeout(tick, 1500);
				};
				watchTimer = setTimeout(tick, 2500);
			};
			const enterRestarting = (mode, bootId) => {
				set({ phase: "restarting", mode });
				watch(bootId, mode);
			};
			const applyStatus = (status) => {
				lastFetchAt = Date.now();
				set({ status, statusFailed: false, logFile: status.logFile ?? state.logFile });
				const restart = status.restart;
				const recent = Date.now() - (Number(restart?.startedAt) || 0) < 120000;
				if (restart && recent && (restart.state === "pending" || restart.state === "handoff") && state.phase !== "restarting") enterRestarting(status.mode, status.bootId);
				if (status.resume && Array.isArray(status.resume.interrupted)) handleResume(status.resume);
			};
			const refreshQuiet = async () => {
				try {
					applyStatus(await fetchStatus(6000));
				} catch {}
			};
			const schedulePoll = () => {
				clearTimeout(pollTimer);
				if (disposed) return;
				const scheduled = state.status?.scheduled != null;
				pollTimer = setTimeout(async () => {
					const hidden = typeof document !== "undefined" && document.hidden;
					if (!hidden || scheduled) await refreshQuiet();
					schedulePoll();
				}, scheduled ? POLL_SCHEDULED_MS : POLL_IDLE_MS);
			};
			const restart = async (when) => {
				set({ phase: "requesting" });
				const before = state.status;
				let result;
				try {
					result = await postJson(ROUTES.restart, { when, activeSessionId: currentSession(), source: "header-button" }, 45000);
				} catch (error) {
					failWith("request", messageOf(error));
					return;
				}
				if (!result.ok || result.body === null || result.body.ok !== true) {
					failWith("request", result.body?.error ?? `HTTP ${result.status}`, result.body?.logFile);
					return;
				}
				if (result.body.scheduled) {
					set({ phase: "idle" });
					await refreshQuiet();
					schedulePoll();
					return;
				}
				set({ logFile: result.body.logFile ?? state.logFile });
				enterRestarting(result.body.mode, before?.bootId ?? result.body.bootId);
			};
			return {
				subscribe: (listener) => {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
				getSnapshot: () => state,
				/** The header of a Session mounted (latest wins); it is reopened after a restart. */
				showSession: (id) => {
					if (typeof id !== "string" || id === "") return () => {};
					sessionsShown.push(id);
					return () => {
						const index = sessionsShown.lastIndexOf(id);
						if (index !== -1) sessionsShown.splice(index, 1);
					};
				},
				/** First status read (with retries), then background polling. */
				start: async () => {
					for (let attempt = 0; attempt < 4 && !disposed; attempt++) {
						try {
							applyStatus(await fetchStatus(8000));
							schedulePoll();
							return;
						} catch {
							await delay(1500 * (attempt + 1));
						}
					}
					set({ statusFailed: true });
					schedulePoll();
				},
				refreshSoon: () => {
					setTimeout(() => {
						refreshQuiet().then(schedulePoll);
					}, 500);
				},
				refreshIfStale: () => {
					if (Date.now() - lastFetchAt > HOVER_REFRESH_MS) refreshQuiet();
				},
				/** Button press: check the Host, ask only when the policy requires it, then restart. */
				request: async () => {
					if (BUSY.has(state.phase) || state.phase === "confirm" || state.phase === "scheduledMenu") return;
					if (state.status?.scheduled) {
						set({ phase: "scheduledMenu" });
						refreshQuiet();
						return;
					}
					set({ phase: "checking", error: null });
					let status;
					try {
						status = await fetchStatus(8000);
					} catch (error) {
						failWith("status", messageOf(error));
						return;
					}
					applyStatus(status);
					if (state.phase === "restarting") return;
					if (!status.supported) {
						failWith("unsupported", "");
						return;
					}
					if (status.scheduled) {
						set({ phase: "scheduledMenu" });
						return;
					}
					const ask = status.confirm === "always" || status.confirm !== "never" && status.activeTasks === true;
					if (ask) set({ phase: "confirm" });
					else await restart("now");
				},
				confirmNow: () => {
					if (state.phase === "confirm" || state.phase === "scheduledMenu") restart("now");
				},
				confirmWhenIdle: () => {
					if (state.phase === "confirm") restart("idle");
				},
				cancelScheduled: async () => {
					if (state.phase !== "scheduledMenu") return;
					set({ phase: "requesting" });
					try {
						const result = await postJson(ROUTES.cancel, {}, 10000);
						if (!result.ok || result.body?.ok !== true) throw new Error(result.body?.error ?? `HTTP ${result.status}`);
					} catch (error) {
						failWith("cancel", messageOf(error));
						return;
					}
					set({ phase: "idle" });
					await refreshQuiet();
					schedulePoll();
				},
				cancel: () => {
					if (state.phase === "confirm" || state.phase === "scheduledMenu") set({ phase: "idle" });
				},
				dismiss: () => {
					if (state.phase === "error") set({ phase: "idle", error: null });
				},
				openSession: (id) => {
					openSession(id);
				},
				/** Send the localized "continue" message to every interrupted Session. */
				continueAll: async () => {
					const resume = state.resume;
					if (resume === null || resume.busy) return;
					set({ resume: { ...resume, busy: true, failed: false } });
					const sessions = env.getService("sessions");
					const text = env.continueText();
					const failed = [];
					for (const id of resume.interrupted) {
						try {
							if (sessions === void 0) throw new Error("sessions service unavailable");
							const answer = await sessions.using(id, { source: "controllerOperation" }, async (reference) => {
								const binding = await reference.ready;
								return binding.session.prompt([{ type: "text", text }], "queue");
							});
							if (answer && answer.ok === false) failed.push(id);
						} catch (error) {
							console.warn("restart-button: could not continue session", id, error);
							failed.push(id);
						}
					}
					if (failed.length === 0) {
						ack(resume.id, "continue");
						set({ resume: null });
					} else set({ resume: { ...resume, interrupted: failed, busy: false, failed: true } });
				},
				dismissResume: () => {
					const resume = state.resume;
					if (resume === null) return;
					ack(resume.id, "dismiss");
					set({ resume: null });
				},
				dismissPlugins: () => {
					const signature = pluginSignature(state.status?.pendingPlugins);
					storageSet(local, DISMISSED_PLUGINS_KEY, signature);
					set({ pluginDismissed: signature });
				},
				dispose: () => {
					disposed = true;
					clearTimeout(watchTimer);
					clearTimeout(pollTimer);
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
		function RestartHeaderButton({ controller, t, sessionId }) {
			const state = useController(controller);
			react.useEffect(() => controller.showSession(sessionId), [controller, sessionId]);
			if (state.status !== null && state.status.supported === false) return null;
			if (state.status === null && state.statusFailed) return null;
			const busy = BUSY.has(state.phase);
			const scheduled = state.status?.scheduled != null;
			const attention = (state.status?.pendingPlugins?.length ?? 0) > 0;
			return jsx(ui.Tooltip, {
				label: () => tooltipText(state, t),
				side: "bottom",
				align: "end",
				delayMs: 400,
				portal: true,
				maxWidth: 360,
				children: jsxs(ui.Button, {
					size: "sm",
					className: "dshRestartButton",
					"data-dsh-restart-button": "",
					"data-busy": busy ? "true" : void 0,
					"data-scheduled": scheduled ? "true" : void 0,
					"aria-label": t("button.label"),
					"aria-busy": busy,
					disabled: busy,
					onMouseEnter: () => {
						controller.refreshIfStale();
					},
					onClick: () => {
						controller.request();
					},
					children: [jsx(ui.IconRefreshOutlineRegular, { size: 15 }), scheduled ? jsx("span", {
						className: "dshRestartBadge",
						"data-kind": "scheduled",
						"aria-hidden": true
					}) : attention ? jsx("span", {
						className: "dshRestartBadge",
						"data-kind": "attention",
						"aria-hidden": true
					}) : null]
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
				case "cancel": return t("error.cancel") + error.message;
				default: return t("error.request") + error.message;
			}
		}
		const SEPARATOR = "\u0001";
		/** Titles of the given Sessions from the shared Session list, without unstable selector results. */
		function useSessionTitles(useSessions, ids, t) {
			const joined = useSessions((snapshot) => ids.map((id) => {
				const title = snapshot?.byId?.[id]?.title;
				return typeof title === "string" ? title.trim() : "";
			}).join(SEPARATOR));
			const titles = joined === "" && ids.length === 0 ? [] : joined.split(SEPARATOR);
			return ids.map((id, index) => titles[index] || t("resume.untitled"));
		}
		const noSessions = (selector) => selector(void 0);
		/** Frame-wide layer: dialogs, the restarting cover, and the resume / plugin cards. */
		function RestartLayer({ controller, t, useSessions }) {
			const state = useController(controller);
			const status = state.status;
			const busyIds = status?.busySessions ?? [];
			const resumeIds = state.resume?.interrupted ?? [];
			const busyTitles = useSessionTitles(useSessions ?? noSessions, busyIds, t);
			const resumeTitles = useSessionTitles(useSessions ?? noSessions, resumeIds, t);
			const pending = status?.pendingPlugins ?? [];
			const showPlugins = pending.length > 0 && pluginSignature(pending) !== state.pluginDismissed && state.phase !== "restarting";
			const busyNames = busyTitles.slice(0, 3).join(t("list.separator")) + (busyIds.length > 3 ? ` ${t("resume.more", { count: String(busyIds.length - 3) })}` : "");
			const notices = [];
			if (state.resume !== null && state.phase !== "restarting") notices.push(jsxs("div", {
				className: "dshRestartNotice",
				role: "status",
				"data-dsh-restart-notice": "resume",
				children: [
					jsx("div", { className: "dshRestartNoticeTitle", children: t("resume.title") }),
					jsx("div", {
						className: state.resume.failed ? "dshRestartNoticeError" : "dshRestartNoticeText",
						children: state.resume.failed ? t("resume.continueFailed") : t("resume.text", { count: String(resumeIds.length) })
					}),
					jsxs("ul", {
						className: "dshRestartNoticeList",
						children: [resumeIds.slice(0, 4).map((id, index) => jsx("li", { children: jsx("button", {
							type: "button",
							className: "dshRestartLink",
							title: resumeTitles[index],
							onClick: () => controller.openSession(id),
							children: resumeTitles[index]
						}) }, id)), resumeIds.length > 4 ? jsx("li", {
							className: "dshRestartNoticeText",
							children: t("resume.more", { count: String(resumeIds.length - 4) })
						}) : null]
					}),
					jsxs("div", {
						className: "dshRestartNoticeActions",
						children: [jsx(ui.Button, {
							size: "sm",
							variant: "outline",
							disabled: state.resume.busy,
							onClick: controller.dismissResume,
							children: t("resume.dismiss")
						}), jsx(ui.Button, {
							size: "sm",
							variant: "primary",
							disabled: state.resume.busy,
							onClick: controller.continueAll,
							children: state.resume.busy ? t("resume.continuing") : t("resume.continue")
						})]
					})
				]
			}, "resume"));
			if (showPlugins) notices.push(jsxs("div", {
				className: "dshRestartNotice",
				role: "status",
				"data-dsh-restart-notice": "plugins",
				children: [
					jsx("div", { className: "dshRestartNoticeTitle", children: t("plugins.title") }),
					jsx("div", { className: "dshRestartNoticeText", children: t("plugins.text") }),
					jsxs("ul", {
						className: "dshRestartNoticeList",
						children: [pending.slice(0, 3).map((item) => jsx("li", {
							title: item.name,
							children: `${item.name}  ${item.from ?? "?"} → ${item.to ?? "?"}`
						}, item.name)), pending.length > 3 ? jsx("li", {
							className: "dshRestartNoticeText",
							children: t("plugins.more", { count: String(pending.length - 3) })
						}) : null]
					}),
					jsxs("div", {
						className: "dshRestartNoticeActions",
						children: [jsx(ui.Button, {
							size: "sm",
							variant: "outline",
							onClick: controller.dismissPlugins,
							children: t("plugins.later")
						}), jsx(ui.Button, {
							size: "sm",
							variant: "primary",
							disabled: BUSY.has(state.phase),
							onClick: () => {
								controller.request();
							},
							children: t("plugins.restart")
						})]
					})
				]
			}, "plugins"));
			const busyTasks = status?.activeTasks === true;
			/** Hosts before 0.2.0 ignore `when: 'idle'` and would restart at once, so only offer it when the Host reports scheduling. */
			const canSchedule = status !== null && Object.prototype.hasOwnProperty.call(status, "scheduled");
			return jsxs(Fragment, { children: [
				jsx(ui.Modal, {
					open: state.phase === "confirm",
					onClose: controller.cancel,
					title: t("confirm.title"),
					closeLabel: t("dialog.close"),
					description: busyTasks ? void 0 : t(status?.confirm === "always" ? "confirm.always" : "confirm.idle"),
					children: busyTasks ? jsxs("div", {
						className: "dshRestartWarn",
						children: [jsx(ui.IconWarningOutlineRegular, { size: 16 }), jsxs("span", { children: [
							busyIds.length > 0 ? t("confirm.busy", { count: String(busyIds.length) }) : t("confirm.busyJobs"),
							busyIds.length > 0 ? jsx("span", {
								className: "dshRestartWarnNames",
								children: t("confirm.busyNames", { names: busyNames })
							}) : null
						] })]
					}) : void 0,
					footer: jsxs(Fragment, { children: [
						jsx(ui.Button, {
							variant: "outline",
							onClick: controller.cancel,
							children: t("confirm.cancel")
						}),
						busyTasks && canSchedule ? jsx(ui.Button, {
							variant: "outline",
							"data-dsh-restart-when-idle": "",
							onClick: controller.confirmWhenIdle,
							children: t("confirm.whenIdle")
						}) : null,
						jsx(ui.Button, {
							variant: "primary",
							"data-modal-autofocus": true,
							"data-dsh-restart-now": "",
							onClick: controller.confirmNow,
							children: t("confirm.ok")
						})
					] })
				}),
				jsx(ui.Modal, {
					open: state.phase === "scheduledMenu",
					onClose: controller.cancel,
					title: t("scheduled.title"),
					closeLabel: t("dialog.close"),
					description: t("scheduled.text"),
					footer: jsxs(Fragment, { children: [jsx(ui.Button, {
						variant: "outline",
						"data-dsh-restart-cancel-scheduled": "",
						onClick: controller.cancelScheduled,
						children: t("scheduled.cancel")
					}), jsx(ui.Button, {
						variant: "primary",
						"data-modal-autofocus": true,
						onClick: controller.confirmNow,
						children: t("scheduled.now")
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
				notices.length > 0 ? reactDom.createPortal(jsx("div", {
					className: "dshRestartNotices",
					children: notices
				}), document.body) : null,
				state.phase === "restarting" ? reactDom.createPortal(jsx("div", {
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
		 * the shipped utilities) and the shared dialogs and cards into the frame overlay.
		 * @param ctx - browser plugin context carrying slots and locale.
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "restart-button: dictionaries");
			const fallbackT = ctx.locale.bind(NS);
			const controller = createRestartController({
				getService: (name) => ctx.get(name),
				continueText: () => fallbackT("resume.prompt"),
				localStorage: typeof window !== "undefined" ? window.localStorage : void 0,
				sessionStorage: typeof window !== "undefined" ? window.sessionStorage : void 0
			});
			ctx.effect(() => () => {
				controller.dispose();
			}, "restart-button: controller");
			controller.start();
			ctx.effect(() => {
				const remote = ctx.get("remote");
				if (typeof remote?.$on !== "function") return () => {};
				const off = remote.$on("plugin-manager/changed", () => {
					controller.refreshSoon();
				});
				return () => {
					if (typeof off === "function") off();
				};
			}, "restart-button: plugin changes");
			ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
				name: "conversation.session.header.utilities",
				id: "restart-button",
				order: 1000,
				label: () => fallbackT("button.label"),
				locale: NS,
				registrant: PLUGIN_ID
			}, (props) => jsx(RestartHeaderButton, {
				controller,
				t: props.t ?? fallbackT,
				sessionId: props.sessionId
			})));
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "restart-button",
				order: 1000,
				locale: NS,
				registrant: PLUGIN_ID
			}, (props) => jsx(RestartLayer, {
				controller,
				t: props.t ?? fallbackT,
				useSessions: props.useSessions
			})));
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		exports.createRestartController = createRestartController;
		exports.tooltipText = tooltipText;
		return module.exports;
	}
});

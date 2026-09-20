const languages = [
  ["ja", "日本語"], ["en", "English"], ["ko", "한국어"], ["zh", "中文"],
  ["es", "Español"], ["fr", "Français"], ["de", "Deutsch"], ["it", "Italiano"],
  ["pt", "Português"], ["th", "ไทย"], ["vi", "Tiếng Việt"], ["id", "Bahasa Indonesia"]
];

const els = {
  sourceLanguage: document.querySelector("#sourceLanguage"),
  targetLanguage: document.querySelector("#targetLanguage"),
  swapButton: document.querySelector("#swapButton"),
  startButton: document.querySelector("#startButton"),
  startButtonText: document.querySelector("#startButtonText"),
  status: document.querySelector("#status"),
  sourceTranscript: document.querySelector("#sourceTranscript"),
  translatedTranscript: document.querySelector("#translatedTranscript"),
  clearButton: document.querySelector("#clearButton"),
  muteButton: document.querySelector("#muteButton"),
  translatedAudio: document.querySelector("#translatedAudio"),
  connectionMetric: document.querySelector("#connectionMetric")
};

for (const [code, label] of languages) {
  els.sourceLanguage.add(new Option(label, code));
  els.targetLanguage.add(new Option(label, code));
}
els.sourceLanguage.value = localStorage.getItem("sourceLanguage") || "ja";
els.targetLanguage.value = localStorage.getItem("targetLanguage") || "en";
if (els.sourceLanguage.value === els.targetLanguage.value) els.targetLanguage.value = "en";

let pc = null;
let dataChannel = null;
let sourceStream = null;
let isLive = false;
let starting = false;
let sourceText = "";
let translatedText = "";
let firstOutputSeen = false;
let connectStartedAt = 0;

function setStatus(state, text) {
  els.status.dataset.state = state;
  els.status.lastChild.textContent = text;
}

function setTranscript(el, text, placeholder) {
  const clean = text.trimStart();
  el.textContent = clean || placeholder;
  el.classList.toggle("placeholder", !clean);
  if (clean) el.scrollTop = el.scrollHeight;
}

function clearTranscripts() {
  sourceText = "";
  translatedText = "";
  setTranscript(els.sourceTranscript, "", "ここに話した内容が表示されます。");
  setTranscript(els.translatedTranscript, "", "翻訳は話している途中から表示されます。");
}

function stopLocalMedia() {
  if (sourceStream) {
    for (const track of sourceStream.getTracks()) track.stop();
    sourceStream = null;
  }
}

function cleanupConnection() {
  try { dataChannel?.close(); } catch {}
  try { pc?.close(); } catch {}
  dataChannel = null;
  pc = null;
  stopLocalMedia();
  els.translatedAudio.srcObject = null;
}

async function fetchClientSecret(targetLanguage) {
  const response = await fetch("/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetLanguage })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || data.error || "セッションを作成できませんでした。APIキー設定を確認してください。");
  if (!data.value) throw new Error("クライアントシークレットを取得できませんでした。");
  return data.value;
}

function handleEvent(event) {
  if (event.type === "session.output_transcript.delta") {
    translatedText += event.delta || "";
    setTranscript(els.translatedTranscript, translatedText, "翻訳は話している途中から表示されます。");
    if (!firstOutputSeen) {
      firstOutputSeen = true;
      const ms = Math.round(performance.now() - connectStartedAt);
      els.connectionMetric.textContent = `最初の翻訳出力 ${ms} ms（接続開始から）`;
    }
    return;
  }

  if (event.type === "session.input_transcript.delta") {
    sourceText += event.delta || "";
    setTranscript(els.sourceTranscript, sourceText, "ここに話した内容が表示されます。");
    return;
  }

  if (event.type === "error") {
    const message = event.error?.message || "リアルタイム翻訳でエラーが発生しました。";
    setStatus("error", "エラー");
    console.error("Realtime error:", event);
    els.connectionMetric.textContent = message;
  }
}

async function startTranslation() {
  if (starting || isLive) return;
  starting = true;
  firstOutputSeen = false;
  connectStartedAt = performance.now();
  setStatus("connecting", "接続中");
  els.startButton.disabled = true;
  els.startButtonText.textContent = "接続中…";
  els.connectionMetric.textContent = "マイクと翻訳セッションを準備中";

  try {
    const targetLanguage = els.targetLanguage.value;
    localStorage.setItem("sourceLanguage", els.sourceLanguage.value);
    localStorage.setItem("targetLanguage", targetLanguage);

    const [stream, clientSecret] = await Promise.all([
      navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1
        }
      }),
      fetchClientSecret(targetLanguage)
    ]);
    sourceStream = stream;

    pc = new RTCPeerConnection();
    pc.addTrack(sourceStream.getAudioTracks()[0], sourceStream);

    pc.ontrack = async ({ streams }) => {
      els.translatedAudio.srcObject = streams[0];
      try { await els.translatedAudio.play(); } catch (error) { console.warn("Audio autoplay:", error); }
    };

    pc.onconnectionstatechange = () => {
      if (!pc) return;
      if (pc.connectionState === "connected") {
        const ms = Math.round(performance.now() - connectStartedAt);
        els.connectionMetric.textContent = `WebRTC 接続 ${ms} ms`;
        setStatus("live", "通訳中");
      } else if (["failed", "disconnected"].includes(pc.connectionState) && isLive) {
        setStatus("error", "切断");
        els.connectionMetric.textContent = "通信が切れました。停止して再接続してください。";
      }
    };

    dataChannel = pc.createDataChannel("oai-events");
    dataChannel.onmessage = ({ data }) => {
      try { handleEvent(JSON.parse(data)); } catch (error) { console.warn("Event parse error", error); }
    };
    dataChannel.onerror = (event) => console.error("DataChannel error", event);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const sdpResponse = await fetch("https://api.openai.com/v1/realtime/translations/calls", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${clientSecret}`,
        "Content-Type": "application/sdp"
      },
      body: offer.sdp
    });

    if (!sdpResponse.ok) throw new Error(await sdpResponse.text());

    await pc.setRemoteDescription({
      type: "answer",
      sdp: await sdpResponse.text()
    });

    isLive = true;
    els.startButton.classList.add("live");
    els.startButtonText.textContent = "通訳を停止";
    els.muteButton.disabled = false;
    setStatus("live", "通訳中");
  } catch (error) {
    console.error(error);
    cleanupConnection();
    isLive = false;
    setStatus("error", "開始できません");
    els.connectionMetric.textContent = error?.message || "接続に失敗しました。";
  } finally {
    starting = false;
    els.startButton.disabled = false;
  }
}

function stopTranslation() {
  if (!isLive && !starting) return;
  cleanupConnection();
  isLive = false;
  starting = false;
  els.startButton.classList.remove("live");
  els.startButtonText.textContent = "通訳を開始";
  els.startButton.disabled = false;
  els.muteButton.disabled = true;
  els.muteButton.textContent = "翻訳音声をミュート";
  els.translatedAudio.muted = false;
  els.connectionMetric.textContent = "WebRTC 直接接続";
  setStatus("idle", "停止中");
}

els.startButton.addEventListener("click", () => isLive ? stopTranslation() : startTranslation());

els.swapButton.addEventListener("click", async () => {
  const wasLive = isLive;
  if (wasLive) stopTranslation();
  const source = els.sourceLanguage.value;
  els.sourceLanguage.value = els.targetLanguage.value;
  els.targetLanguage.value = source;
  localStorage.setItem("sourceLanguage", els.sourceLanguage.value);
  localStorage.setItem("targetLanguage", els.targetLanguage.value);
  if (wasLive) await startTranslation();
});

els.clearButton.addEventListener("click", clearTranscripts);

els.muteButton.addEventListener("click", () => {
  els.translatedAudio.muted = !els.translatedAudio.muted;
  els.muteButton.textContent = els.translatedAudio.muted ? "翻訳音声を再開" : "翻訳音声をミュート";
});

els.sourceLanguage.addEventListener("change", () => {
  localStorage.setItem("sourceLanguage", els.sourceLanguage.value);
  if (els.sourceLanguage.value === els.targetLanguage.value) {
    const fallback = els.sourceLanguage.value === "ja" ? "en" : "ja";
    els.targetLanguage.value = fallback;
  }
});

els.targetLanguage.addEventListener("change", async () => {
  if (els.targetLanguage.value === els.sourceLanguage.value) {
    const fallback = els.targetLanguage.value === "ja" ? "en" : "ja";
    els.sourceLanguage.value = fallback;
  }
  localStorage.setItem("targetLanguage", els.targetLanguage.value);
  if (isLive) {
    stopTranslation();
    await startTranslation();
  }
});

window.addEventListener("beforeunload", cleanupConnection);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(console.warn));
}

clearTranscripts();

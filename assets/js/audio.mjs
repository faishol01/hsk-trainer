export function createSpeechPlayer() {
  let speechAudio = null,
    speechTimer = null,
    speechRequest = 0;
  function stopSpeech() {
    speechRequest++;
    clearTimeout(speechTimer);
    speechTimer = null;
    if (speechAudio) {
      speechAudio.pause();
      speechAudio.removeAttribute("src");
      speechAudio.load();
      speechAudio = null;
    }
  }
  function playSpeech(text, status) {
    stopSpeech();
    let request = speechRequest;
    status.textContent = "Loading speech…";
    let params = new URLSearchParams({
      ie: "UTF-8",
      client: "tw-ob",
      tl: "zh-CN",
      q: text,
    });
    let audio = new Audio(
      "https://translate.google.com/translate_tts?" + params.toString(),
    );
    speechAudio = audio;
    function fail() {
      if (request === speechRequest)
        status.textContent = "Speech unavailable; check your connection";
    }
    audio.onplaying = () => {
      if (request === speechRequest) status.textContent = "";
    };
    audio.onerror = fail;
    audio.onended = () => {
      if (request !== speechRequest) return;
      speechTimer = setTimeout(() => {
        speechTimer = null;
        if (request === speechRequest) status.textContent = "";
      }, 700);
    };
    speechTimer = setTimeout(() => {
      speechTimer = null;
      if (request !== speechRequest) return;
      audio.play().catch(fail);
    }, 700);
  }
  return { stopSpeech, playSpeech };
}

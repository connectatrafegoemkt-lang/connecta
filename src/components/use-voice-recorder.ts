"use client";

import { useEffect, useRef, useState } from "react";

/** Grava um áudio pelo microfone do navegador (webm/opus). */
export function useVoiceRecorder() {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [audio, setAudio] = useState<Blob | null>(null);
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
      recorder.current?.stream.getTracks().forEach((t) => t.stop());
    },
    [],
  );
  useEffect(
    () => () => {
      if (audioSrc) URL.revokeObjectURL(audioSrc);
    },
    [audioSrc],
  );

  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks.current, { type: rec.mimeType || "audio/webm" });
        setAudioSrc(URL.createObjectURL(blob));
        setAudio(blob);
      };
      recorder.current = rec;
      rec.start();
      setSeconds(0);
      setRecording(true);
      timer.current = setInterval(() => setSeconds((v) => v + 1), 1000);
    } catch {
      setError("Não foi possível acessar o microfone. Libere a permissão no navegador (ícone de cadeado ao lado do endereço).");
    }
  }

  function stop() {
    recorder.current?.stop();
    setRecording(false);
    if (timer.current) clearInterval(timer.current);
  }

  function discard() {
    setAudio(null);
    setAudioSrc(null);
  }

  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  return { recording, audio, audioSrc, error, mmss, start, stop, discard };
}

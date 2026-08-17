import { useCallback, useEffect, useRef, useState } from 'react'
import { Modal } from '../../ui/Modal'
import { Button } from '../../ui/Button'
import { CameraIcon } from '../../ui/icons'

interface Props {
  open: boolean
  onClose: () => void
  onCapture: (file: File) => void
}

/**
 * Câmera nativa do aparelho (celular ou webcam do PC) via getUserMedia.
 * A foto capturada vira um File JPEG, igual a um arquivo escolhido do disco.
 */
export function CameraCapture({ open, onClose, onCapture }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment')

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setReady(false)
  }, [])

  useEffect(() => {
    if (!open) {
      stop()
      return
    }

    let cancelled = false
    setError(null)

    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          void videoRef.current.play()
        }
        setReady(true)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(
          err instanceof DOMException && err.name === 'NotAllowedError'
            ? 'Permissão de câmera negada. Autorize o acesso no navegador para tirar fotos.'
            : 'Não foi possível acessar a câmera deste dispositivo.',
        )
      })

    return () => {
      cancelled = true
      stop()
    }
  }, [open, facingMode, stop])

  function shoot() {
    const video = videoRef.current
    if (!video || !video.videoWidth) return

    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d')?.drawImage(video, 0, 0)

    canvas.toBlob(
      (blob) => {
        if (!blob) return
        onCapture(new File([blob], `foto-${Date.now()}.jpg`, { type: 'image/jpeg' }))
      },
      'image/jpeg',
      0.92,
    )
  }

  return (
    <Modal open={open} onClose={onClose} title="Tirar foto do veículo" size="lg">
      <div className="space-y-4">
        {error ? (
          <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
        ) : (
          <div className="relative overflow-hidden rounded-3xl bg-ink-900">
            <video ref={videoRef} playsInline muted className="aspect-[4/3] w-full object-cover" />
            {!ready && (
              <div className="absolute inset-0 grid place-items-center text-sm text-white/80">Abrindo câmera…</div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            variant="secondary"
            onClick={() => setFacingMode((mode) => (mode === 'environment' ? 'user' : 'environment'))}
            disabled={!ready}
          >
            Trocar câmera
          </Button>
          <div className="flex gap-3">
            <Button variant="ghost" onClick={onClose}>
              Fechar
            </Button>
            <Button onClick={shoot} disabled={!ready} icon={<CameraIcon />}>
              Capturar
            </Button>
          </div>
        </div>

        <p className="text-xs text-ink-400">
          Você pode capturar quantas fotos quiser — cada clique adiciona uma miniatura ao anúncio.
        </p>
      </div>
    </Modal>
  )
}

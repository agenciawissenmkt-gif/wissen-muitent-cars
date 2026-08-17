import { useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Button } from '../../ui/Button'
import { CameraIcon, TrashIcon, UploadIcon } from '../../ui/icons'
import { CameraCapture } from './CameraCapture'
import type { PhotoItem } from './useCars'

interface Props {
  photos: PhotoItem[]
  onChange: (photos: PhotoItem[]) => void
}

const MAX_PHOTOS = 20

export function PhotoPicker({ photos, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [cameraOpen, setCameraOpen] = useState(false)

  function addFiles(files: FileList | File[]) {
    const images = Array.from(files).filter((file) => file.type.startsWith('image/'))
    const room = MAX_PHOTOS - photos.length
    const next: PhotoItem[] = images.slice(0, Math.max(room, 0)).map((file) => ({
      kind: 'new',
      id: crypto.randomUUID(),
      url: URL.createObjectURL(file),
      file,
    }))
    if (next.length) onChange([...photos, ...next])
  }

  function remove(id: string) {
    const target = photos.find((photo) => photo.id === id)
    if (target?.kind === 'new') URL.revokeObjectURL(target.url)
    onChange(photos.filter((photo) => photo.id !== id))
  }

  return (
    <div className="space-y-3">
      <div
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          addFiles(event.dataTransfer.files)
        }}
        className={`rounded-3xl border-2 border-dashed p-6 text-center transition-colors ${
          dragging ? 'border-brand-500 bg-brand-50' : 'border-ink-200 bg-ink-50/50'
        }`}
      >
        <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-white text-brand-600 shadow-sm">
          <UploadIcon />
        </div>
        <p className="mt-3 text-sm font-semibold text-ink-900">Arraste as fotos do veículo aqui</p>
        <p className="mt-1 text-xs text-ink-500">
          JPG ou PNG, até {MAX_PHOTOS} fotos. A primeira foto é usada como capa do anúncio.
        </p>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <Button type="button" variant="secondary" size="sm" onClick={() => inputRef.current?.click()} icon={<UploadIcon className="size-4" />}>
            Escolher arquivos
          </Button>
          <Button type="button" size="sm" onClick={() => setCameraOpen(true)} icon={<CameraIcon className="size-4" />}>
            Tirar foto
          </Button>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(event) => {
            if (event.target.files) addFiles(event.target.files)
            event.target.value = ''
          }}
        />
      </div>

      {photos.length > 0 && (
        <ul className="grid grid-cols-3 gap-3 sm:grid-cols-5">
          <AnimatePresence initial={false}>
            {photos.map((photo, index) => (
              <motion.li
                key={photo.id}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="group relative aspect-square overflow-hidden rounded-2xl border border-ink-200 bg-ink-100"
              >
                <img src={photo.url} alt="" className="size-full object-cover" />
                {index === 0 && (
                  <span className="absolute left-1.5 top-1.5 rounded-full bg-brand-600 px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-wide text-white">
                    Capa
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => remove(photo.id)}
                  aria-label="Remover foto"
                  className="absolute right-1.5 top-1.5 grid size-7 place-items-center rounded-full bg-white/90 text-ink-700 opacity-0 shadow transition-opacity hover:text-red-600 group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <TrashIcon className="size-4" />
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}

      <CameraCapture
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={(file) => addFiles([file])}
      />
    </div>
  )
}

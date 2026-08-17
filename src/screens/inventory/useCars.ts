import { useCallback, useEffect, useState } from 'react'
import { CAR_PHOTOS_BUCKET, supabase } from '../../core/supabase'
import type { Car } from '../../core/types'

/** Campos editáveis pelo painel — espelham as colunas de `cars`. */
export interface CarDraft {
  brand: string | null
  model: string
  version: string | null
  year: number | null
  model_year: number | null
  color: string | null
  doors: number | null
  transmission: string | null
  body_type: string | null
  fuel: string | null
  mileage_km: number | null
  price_brl: number | null
  engine: string | null
  cylinders: string | null
  horsepower: string | null
  torque: string | null
  acceleration_0_100: string | null
  aspiration: string | null
  traction: string | null
  air_conditioning: string | null
  steering: string | null
  electric_windows: string | null
  ipva_paid: boolean
  licensed: boolean
  single_owner: boolean
  dealer_revisions: boolean
  accepts_trade: boolean
  description: string | null
  status: Car['status']
}

/** Foto já salva no banco ou arquivo novo ainda não enviado. */
export type PhotoItem =
  | { kind: 'existing'; id: string; url: string; storage_path: string | null }
  | { kind: 'new'; id: string; url: string; file: File }

interface Options {
  tenantId: string | undefined
  storeId: string | undefined
}

function sortPhotos(car: Car): Car {
  return {
    ...car,
    car_photos: [...(car.car_photos ?? [])].sort(
      (a, b) => Number(b.is_cover) - Number(a.is_cover) || a.ordem - b.ordem,
    ),
  }
}

export function useCars({ tenantId, storeId }: Options) {
  const [cars, setCars] = useState<Car[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!tenantId) return
    setLoading(true)

    const { data, error: queryError } = await supabase
      .from('cars')
      .select('*, car_photos(*)')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })

    if (queryError) {
      setError(queryError.message)
    } else {
      setError(null)
      setCars((data as Car[]).map(sortPhotos))
    }
    setLoading(false)
  }, [tenantId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /** Cria ou atualiza o veículo e sincroniza as fotos (upload, ordem e remoções). */
  const saveCar = useCallback(
    async (draft: CarDraft, photos: PhotoItem[], carId?: string) => {
      if (!tenantId) throw new Error('Loja não identificada.')

      const { data: saved, error: saveError } = carId
        ? await supabase
            .from('cars')
            .update({ ...draft, updated_at: new Date().toISOString() })
            .eq('id', carId)
            .select('id')
            .single()
        : await supabase
            .from('cars')
            .insert({ ...draft, tenant_id: tenantId, ...(storeId ? { store_id: storeId } : {}) })
            .select('id')
            .single()

      if (saveError) throw saveError
      const id = (saved as { id: string }).id

      // Fotos que o usuário tirou do anúncio
      if (carId) {
        const kept = new Set(photos.filter((photo) => photo.kind === 'existing').map((photo) => photo.id))
        const { data: current } = await supabase.from('car_photos').select('id,storage_path').eq('car_id', carId)
        const removed = (current ?? []).filter((photo) => !kept.has(photo.id as string))

        if (removed.length) {
          await supabase
            .from('car_photos')
            .delete()
            .in(
              'id',
              removed.map((photo) => photo.id as string),
            )

          const paths = removed
            .map((photo) => photo.storage_path as string | null)
            .filter((path): path is string => Boolean(path))
          if (paths.length) await supabase.storage.from(CAR_PHOTOS_BUCKET).remove(paths)
        }
      }

      // Sobe as novas e regrava ordem/capa de todas
      const rows: {
        tenant_id: string
        car_id: string
        url: string
        storage_path: string | null
        ordem: number
        is_cover: boolean
      }[] = []

      let coverUrl: string | null = null

      for (const [index, photo] of photos.entries()) {
        if (photo.kind === 'existing') {
          await supabase.from('car_photos').update({ ordem: index, is_cover: index === 0 }).eq('id', photo.id)
          if (index === 0) coverUrl = photo.url
          continue
        }

        const extension = (photo.file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')
        const path = `${tenantId}/${id}/${crypto.randomUUID()}.${extension || 'jpg'}`

        const { error: uploadError } = await supabase.storage
          .from(CAR_PHOTOS_BUCKET)
          .upload(path, photo.file, { contentType: photo.file.type || 'image/jpeg', upsert: false })

        if (uploadError) throw new Error(`Falha ao enviar a foto: ${uploadError.message}`)

        const { data: publicUrl } = supabase.storage.from(CAR_PHOTOS_BUCKET).getPublicUrl(path)
        if (index === 0) coverUrl = publicUrl.publicUrl

        rows.push({
          tenant_id: tenantId,
          car_id: id,
          url: publicUrl.publicUrl,
          storage_path: path,
          ordem: index,
          is_cover: index === 0,
        })
      }

      if (rows.length) {
        const { error: photosError } = await supabase.from('car_photos').insert(rows)
        if (photosError) throw photosError
      }

      // cover_url é o que o agente usa como foto principal no WhatsApp
      await supabase.from('cars').update({ cover_url: coverUrl }).eq('id', id)

      await refresh()
      return id
    },
    [tenantId, storeId, refresh],
  )

  const deleteCar = useCallback(
    async (car: Car) => {
      const paths = car.car_photos.map((photo) => photo.storage_path).filter((path): path is string => Boolean(path))

      // car_photos não tem cascade no banco: apaga as fotos antes do veículo.
      await supabase.from('car_photos').delete().eq('car_id', car.id)

      const { error: deleteError } = await supabase.from('cars').delete().eq('id', car.id)
      if (deleteError) throw deleteError

      if (paths.length) await supabase.storage.from(CAR_PHOTOS_BUCKET).remove(paths)
      await refresh()
    },
    [refresh],
  )

  return { cars, loading, error, refresh, saveCar, deleteCar }
}

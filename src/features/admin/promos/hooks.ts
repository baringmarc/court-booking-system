import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { currentVenueId } from '../../../lib/currentVenue'
import { deletePromo, fetchPromos, promoKeys, savePromo } from './api'

export function usePromos() {
  return useQuery({ queryKey: promoKeys.all(), queryFn: fetchPromos })
}

/** A promo changes slot prices, so the player grid's cached prices are refreshed too. */
function useRefresh() {
  const qc = useQueryClient()
  return () => Promise.all([
    qc.invalidateQueries({ queryKey: promoKeys.all() }),
    qc.invalidateQueries({ queryKey: [currentVenueId(), 'availability'] }),
  ])
}

export function useSavePromo() {
  const refresh = useRefresh()
  return useMutation({ mutationFn: savePromo, onSettled: refresh })
}

export function useDeletePromo() {
  const refresh = useRefresh()
  return useMutation({ mutationFn: deletePromo, onSettled: refresh })
}

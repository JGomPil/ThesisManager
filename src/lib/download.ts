/**
 * Descarga de un fichero generado en el navegador.
 *
 * No hay servidor que lo sirva —la aplicación es estática en GitHub Pages— así
 * que el fichero se construye en memoria y se entrega con un enlace temporal.
 *
 * EL BOM DE UTF-8 NO ES OPCIONAL en el CSV. Sin él, Excel en Windows interpreta
 * el fichero en la codificación del sistema y «Dirección» aparece como
 * «DirecciÃ³n» en todas las filas. Es el fallo clásico de los informes
 * exportados, y se arregla con tres bytes.
 */
export function descargarTexto(nombre: string, contenido: string, tipo: string, conBom = false) {
  const partes = conBom ? ['﻿', contenido] : [contenido]
  const url = URL.createObjectURL(new Blob(partes, { type: tipo }))
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Se libera en el siguiente ciclo: revocarla antes de que el navegador haya
  // empezado la descarga la cancela en algunos navegadores.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const descargarCsv = (nombre: string, csv: string) =>
  descargarTexto(nombre, csv, 'text/csv;charset=utf-8', true)

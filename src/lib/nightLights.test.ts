import { test } from 'node:test'
import assert from 'node:assert/strict'
import { boatLightsLayerFor } from './nightLights.ts'

test('近期用 NOAA-20 輻射亮度（海面黑、漁船是亮點），不是已經沒資料的 SNPP ENCC', () => {
  assert.deepEqual(boatLightsLayerFor('2026-11-14'), { id: 'VIIRS_NOAA20_DayNightBand_At_Sensor_Radiance', level: 8 })
  assert.deepEqual(boatLightsLayerFor('2024-03-25'), { id: 'VIIRS_NOAA20_DayNightBand_At_Sensor_Radiance', level: 8 })
})

test('舊日期：2023-07-07 以前還是原本的 SNPP ENCC；中間空窗用 NOAA-20 DayNightBand（第 7 層）', () => {
  assert.equal(boatLightsLayerFor('2023-07-07').id, 'VIIRS_SNPP_DayNightBand_ENCC')
  assert.equal(boatLightsLayerFor('2020-01-01').id, 'VIIRS_SNPP_DayNightBand_ENCC')
  assert.deepEqual(boatLightsLayerFor('2023-12-01'), { id: 'VIIRS_NOAA20_DayNightBand', level: 7 })
})

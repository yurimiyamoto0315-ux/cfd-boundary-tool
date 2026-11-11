"""Shared browser/native solar calculations. Inputs never require network access."""
import csv
import hashlib
import io
import json
import math
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
import pvlib

PVLIB_VERSION = '0.16.1'
_epw = None


def finite(value, name, lower=None, upper=None):
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ValueError(name + 'を入力してください') from None
    if not math.isfinite(number) or (lower is not None and number < lower) or (upper is not None and number > upper):
        raise ValueError(name + 'の値が範囲外です')
    return number


def load_epw(text):
    """Accept only complete, chronological, non-leap, hourly annual EPW data."""
    global _epw
    _epw = None  # A failed replacement must not revive the previous file.
    text = text.lstrip('\ufeff')
    rows = list(csv.reader(io.StringIO(text)))
    while rows and not any(cell.strip() for cell in rows[-1]):
        rows.pop()
    if len(rows) != 8768 or not rows or rows[0][0].upper() != 'LOCATION':
        raise ValueError('年間8760行・1時間間隔のEPWを指定してください')
    header = rows[0]
    if len(header) < 10:
        raise ValueError('EPWの地点情報が不足しています')
    meta = {'name': header[1], 'latitude': finite(header[6], 'EPW緯度', -90, 90),
            'longitude': finite(header[7], 'EPW経度', -180, 180),
            'utcOffset': finite(header[8], 'EPW時差', -12, 14),
            'altitude': finite(header[9], 'EPW標高', -500, 10000)}
    period = rows[7]
    if len(period) < 3 or period[0].upper() != 'DATA PERIODS' or period[1:3] != ['1', '1']:
        raise ValueError('EPWは1期間・1時間間隔の年間データに対応しています')
    start = datetime(2001, 1, 1)
    for index, row in enumerate(rows[8:]):
        label = f'EPW {index + 9}行目：'
        if len(row) < 35:
            raise ValueError(label + '列が不足しています')
        day = start + timedelta(hours=index)
        try:
            actual = tuple(int(row[col]) for col in [1, 2, 3, 4])
        except ValueError:
            raise ValueError(label + '日時が不正です') from None
        if actual != (day.month, day.day, day.hour + 1, 60):
            raise ValueError(label + '日時の欠落・重複・順序、または時間間隔を確認してください')
        temperature = finite(row[6], label + '外気温', -90, 70)
        if temperature == 99.9:
            raise ValueError(label + '外気温が欠損しています')
        for col, name in [(13, 'GHI'), (14, 'DNI'), (15, 'DHI')]:
            finite(row[col], label + name, 0, 9998)
    frame, _ = pvlib.iotools.read_epw(io.StringIO(text), coerce_year=2001)
    digest = hashlib.sha256(text.encode('utf-8')).hexdigest()
    meta.update(hash=digest, records=len(frame), intervalMinutes=60)
    _epw = (frame, meta)
    return meta


def compute(request):
    if pvlib.__version__ != PVLIB_VERSION:
        raise ValueError('pvlibの版が一致しません')
    source = request['source']
    if source not in ('pvlib-clear', 'pvlib-epw'):
        raise ValueError('日射方式が不正です')
    try:
        day = datetime.strptime(request['date'], '%Y-%m-%d')
    except (ValueError, KeyError, TypeError):
        raise ValueError('解析対象の日付を確認してください') from None
    hour = finite(request['hour'], '解析時刻', 0, 24)
    albedo = finite(request['albedo'], '地面反射率', 0, 1)
    if source == 'pvlib-epw':
        if _epw is None or request.get('epwHash') != _epw[1]['hash']:
            raise ValueError('この設定で使用するEPWを読み直してください')
        if day.month == 2 and day.day == 29:
            raise ValueError('このEPWに2月29日はありません')
        if hour not in range(1, 25):
            raise ValueError('EPWの時刻は1〜24時終了の時間帯を選んでください（0.5時間の補間はしません）')
        frame, meta = _epw
        latitude, longitude, altitude = meta['latitude'], meta['longitude'], meta['altitude']
        offset = meta['utcOffset']
        hours = list(range(1, 25))
        selected = frame[(frame['month'] == day.month) & (frame['day'] == day.day)]
        # EPW radiation is Wh/m² for the preceding 1 h. Divide by 1 h, not 3600 s.
        dni, dhi, ghi = [selected[name].to_numpy(dtype=float) / 1.0 for name in ['dni', 'dhi', 'ghi']]
        temperatures = selected['temp_air'].to_numpy(dtype=float)
        position_hours = [value - .5 for value in hours]
        provenance = dict(meta, weather='EPW', timeBasis='hour-ending', altitudeSource='EPWヘッダー')
    else:
        latitude = finite(request.get('latitude'), '緯度', -90, 90)
        longitude = finite(request.get('longitude'), '経度', -180, 180)
        altitude = float(pvlib.location.lookup_altitude(latitude, longitude))
        offset = 9
        hours = sorted(set([value / 2 for value in range(49)] + [hour]))
        position_hours = hours
        maximum = finite(request.get('tmax'), '最高気温', -90, 70)
        minimum = finite(request.get('tmin'), '最低気温', -90, 70)
        peak = finite(request.get('tpeak'), '気温ピーク時刻', 0, 24)
        if maximum < minimum:
            raise ValueError('最高気温を最低気温以上にしてください')
        temperatures = np.array([(maximum + minimum) / 2 + (maximum - minimum) / 2 *
                                 math.cos(2 * math.pi * (value - peak) / 24) for value in hours])
        provenance = {'weather': 'Ineichen晴天推定', 'timeBasis': 'instantaneous',
                      'altitudeSource': 'pvlib同梱地形データ', 'utcOffset': offset,
                      'latitude': latitude, 'longitude': longitude, 'altitude': altitude}
    zone = timezone(timedelta(hours=offset))
    beginning = pd.Timestamp(day, tz=zone)
    times = pd.DatetimeIndex([beginning + pd.Timedelta(value, unit='h') for value in position_hours])
    # The explicit DatetimeIndex carries the fixed EPW offset (including half hours).
    # Location.tz expects an IANA name; no time index is generated from it here.
    location = pvlib.location.Location(latitude, longitude, tz='UTC', altitude=altitude)
    position = location.get_solarposition(times, method='nrel_numpy')
    if source == 'pvlib-clear':
        clearsky = location.get_clearsky(times, model='ineichen', solar_position=position)
        dni, dhi, ghi = [clearsky[name].to_numpy(dtype=float) for name in ['dni', 'dhi', 'ghi']]
    zenith = position['apparent_zenith'].to_numpy(dtype=float)
    azimuth = position['azimuth'].to_numpy(dtype=float)
    elevation = position['apparent_elevation'].to_numpy(dtype=float)
    effective_dni = np.where(elevation > 0, dni, 0)
    surfaces = {}
    for surface in request['surfaces']:
        tilt = finite(surface['tilt'], '面の勾配', 0, 180)
        surface_azimuth = finite(surface['azimuth'], '面の方位', 0, 360)
        poa = pvlib.irradiance.get_total_irradiance(
            tilt, surface_azimuth, zenith, azimuth, effective_dni, ghi, dhi,
            albedo=albedo, model='isotropic')
        surfaces[surface['id']] = {key: np.maximum(0, poa[name]).tolist() for key, name in
                                 [('beam', 'poa_direct'), ('sky', 'poa_sky_diffuse'),
                                  ('ground', 'poa_ground_diffuse'), ('total', 'poa_global')]}
    provenance.update(pvlib=PVLIB_VERSION, solarPosition='NREL SPA / nrel_numpy',
                      transposition='isotropic', albedo=albedo, source=source)
    return {'source': source, 'date': request['date'], 'hours': hours,
            'positionHours': position_hours, 'selected': hours.index(hour),
            'sun': {'altitude': elevation.tolist(), 'azimuth': azimuth.tolist()},
            'weather': {'dni': effective_dni.tolist(), 'dhi': dhi.tolist(), 'ghi': ghi.tolist(),
                        'temperature': temperatures.tolist()},
            'surfaces': surfaces, 'provenance': provenance}


def handle_json(payload):
    data = json.loads(payload)
    result = load_epw(data['text']) if data.get('command') == 'load-epw' else compute(data)
    return json.dumps(result, ensure_ascii=False, allow_nan=False)

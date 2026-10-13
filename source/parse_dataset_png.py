"""Read one-image Sketch Town training export, including original user stroke labels.

Usage: python parse_dataset_png.py SketchTown_Dataset_XX.png [--json output.json]
Pure Python standard library, works without a browser or a learning runtime.
"""
from __future__ import annotations
import argparse
import json
import pathlib
import struct
import zlib

SIGNATURE = b'\x89PNG\r\n\x1a\n'
KEY = b'SketchTownDataset'


def read_dataset(path: str | pathlib.Path) -> dict:
    data = pathlib.Path(path).read_bytes()
    if not data.startswith(SIGNATURE):
        raise ValueError('PNG 파일이 아닙니다.')
    offset = len(SIGNATURE)
    while offset + 12 <= len(data):
        length = struct.unpack_from('>I', data, offset)[0]
        total = 12 + length
        if offset + total > len(data):
            raise ValueError('잘린 PNG 청크')
        kind = data[offset + 4:offset + 8]
        value = data[offset + 8:offset + 8 + length]
        saved_crc = struct.unpack_from('>I', data, offset + 8 + length)[0]
        actual_crc = zlib.crc32(data[offset + 4:offset + 8 + length]) & 0xffffffff
        if saved_crc != actual_crc:
            raise ValueError(f'PNG 체크섬 오류: {kind!r}')
        if kind == b'tEXt' and value.startswith(KEY + b'\x00'):
            payload = json.loads(value[len(KEY) + 1:].decode('utf-8'))
            if payload.get('format') != 'SketchTownDataset' or payload.get('version') != 2:
                raise ValueError('지원하지 않는 학습 데이터 버전')
            count = payload.get('count')
            entries = payload.get('entries')
            if not isinstance(entries, list) or len(entries) != count:
                raise ValueError('학습 데이터 표본 개수가 일치하지 않습니다.')
            for entry in entries:
                if 'jitter' in entry:
                    raise ValueError('증강본은 저장하지 않습니다.')
                if not isinstance(entry.get('flags'), dict) or not isinstance(entry.get('points'), list) or not entry.get('label'):
                    raise ValueError('원본 획 좌표 또는 라벨이 손상되었습니다.')
            return payload
        offset += total
    raise ValueError('SketchTownDataset 메타데이터가 없는 PNG입니다.')


def main():
    parser = argparse.ArgumentParser(description='스케치 타운 PNG 학습 데이터 추출')
    parser.add_argument('png', type=pathlib.Path)
    parser.add_argument('--json', type=pathlib.Path, default=None, help='메타데이터 JSON 파일로 추출 (선택)')
    args = parser.parse_args()
    dataset = read_dataset(args.png)
    counts = {}
    for entry in dataset['entries']:
        counts[entry['label']] = counts.get(entry['label'], 0) + 1
    print(json.dumps({'original_strokes': dataset['count'], 'classes': counts, 'augmentation_flags_stored': True}, ensure_ascii=False, indent=2))
    if args.json is not None:
        args.json.write_text(json.dumps(dataset, ensure_ascii=False, indent=2), encoding='utf-8')
        print(f'저장: {args.json}')


if __name__ == '__main__':
    main()

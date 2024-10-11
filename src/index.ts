import { BitField } from '@sapphire/bitfield';
import { openSync, readSync } from 'fs';
import { EngineFlags, Flags, PitServiceFlags } from './fields/flags';
import { DiskSubHeader } from './types/disk-sub-header';
import { Header } from './types/header';
import { VarHeader } from './types/var-header';

const HEADER_LENGTH = 112;
const DISK_SUB_HEADER_LENGTH = 32;
const VAR_HEADER_SIZE = 144;

const fileToBuffer = async (file: number, start: number, length: number): Promise<Buffer> => {
  const buffer = Buffer.alloc(length);
  const bufferLength = await readSync(file, buffer, 0, length, start);

  if (bufferLength === 0) {
    throw new Error();
  }

  return buffer;
};

const getString = (buffer: Buffer, start: number, length: number): string => {
  return buffer
    .subarray(start, start + length)
    .toString('ascii')
    .replace(/\0/g, '');
};

const getValue = (
  buffer: Buffer,
  start: number,
  type: 'int8' | 'int32' | 'float' | 'double' | 'bit' = 'int32',
): number => {
  switch (type) {
    case 'int8':
      return buffer.subarray(start, start + 1).readInt8();
    case 'int32':
      return buffer.subarray(start, start + 4).readInt32LE();
    case 'float':
      return buffer.subarray(start, start + 8).readFloatLE();
    case 'double':
      return buffer.subarray(start, start + 8).readDoubleLE();
    case 'bit':
      return buffer.subarray(start, start + 4).readUInt32LE();
  }
};

const readHeader = (buffer: Buffer): Header => {
  return {
    version: getValue(buffer, 0),
    status: getValue(buffer, 4),
    tickRate: getValue(buffer, 8),
    sessionInfoUpdate: getValue(buffer, 12),
    sessionInfoLength: getValue(buffer, 16),
    sessionInfoOffset: getValue(buffer, 20),
    numVars: getValue(buffer, 24),
    varHeaderOffset: getValue(buffer, 28),
    numBuf: getValue(buffer, 32),
    bufLen: getValue(buffer, 36),
    bufOffset: getValue(buffer, 52),
  };
};

const readVarHeader = (buffer: Buffer, header: Header): VarHeader[] => {
  const numberOfVariables = header.numVars;
  const varHeaders: VarHeader[] = [];

  return Array.from(Array(numberOfVariables).keys()).map((index: number) => {
    const start = index * VAR_HEADER_SIZE;

    return {
      type: getValue(buffer, start),
      offset: getValue(buffer, start + 4),
      count: getValue(buffer, start + 8),
      countAsTime: getValue(buffer, start + 12, 'int8'),
      name: getString(buffer, start + 16, 32),
      description: getString(buffer, start + 16 + 32, 64),
      unit: getString(buffer, start + 16 + 32 + 64, 32),
    };
  });
};

const readDiskSubHeader = (buffer: Buffer): DiskSubHeader => {
  const sessionStartDate = getValue(buffer, 0);

  return {
    sessionStartDate: new Date(sessionStartDate * 1000),
    startTime: getValue(buffer, 8, 'double'),
    endTime: getValue(buffer, 16, 'double'),
    lapCount: getValue(buffer, 24),
    recordCount: getValue(buffer, 28),
  };
};

async function main(): Promise<void> {
  const path = 'telemetry.ibt';

  const telemetryFile = await openSync(path, 'r');

  // header
  const headerBuffer = await fileToBuffer(telemetryFile, 0, HEADER_LENGTH);
  const header = readHeader(headerBuffer);

  // diskSubHeader
  const diskSubHeaderBuffer = await fileToBuffer(telemetryFile, HEADER_LENGTH, DISK_SUB_HEADER_LENGTH);
  const diskSubHeader = readDiskSubHeader(diskSubHeaderBuffer);

  // sessionInfo
  const sessionInfoBuffer = await fileToBuffer(telemetryFile, header.sessionInfoLength, header.sessionInfoOffset);
  const sessionInfo = sessionInfoBuffer.toString('ascii');

  // variable headers
  const numberOfVariables = header.numVars;
  const startPosition = header.varHeaderOffset;
  const fullBufferSize = numberOfVariables * VAR_HEADER_SIZE;

  const varHeaderBuffer = await fileToBuffer(telemetryFile, startPosition, fullBufferSize);
  const varHeader = readVarHeader(varHeaderBuffer, header);

  // samples
  let sample = 19000; // 19000 is a good value to start with (for the example telemetry file)
  let endOfSamplesReached = false;

  while (!endOfSamplesReached) {
    console.log(`- sample #${sample} -----------------------------------------------`);

    const start = header.bufOffset + sample * header.bufLen;

    try {
      const sampleBuffer = await fileToBuffer(telemetryFile, start, header.bufLen);

      varHeader.map((header) => {
        if (header.type === 0) {
          // char
          const sampleValue = getString(sampleBuffer, header.offset, 1);
          console.log(header.name, header.type, sampleValue);
        }

        if (header.type === 1) {
          // boolean
          const sampleValue = getValue(sampleBuffer, header.offset, 'int8') === 1 ? true : false;
          console.log(header.name, header.type, sampleValue);
        }

        if (header.type === 2) {
          // int
          const sampleValue = getValue(sampleBuffer, header.offset);
          console.log(header.name, header.type, sampleValue);
        }

        if (header.type === 3) {
          // bit field
          const sampleValue = sampleBuffer.subarray(header.offset, header.offset + 4).readUInt32LE();

          if (header.unit === 'irsdk_Flags') {
            const FlagsBitField = new BitField(Flags);
            console.log(header.name, header.type, FlagsBitField.toObject(+sampleValue.toString(16)));
          }
          if (header.unit === 'irsdk_EngineWarnings') {
            const EngineFlagsBitField = new BitField(EngineFlags);
            console.log(header.name, header.type, EngineFlagsBitField.toObject(+sampleValue.toString(16)));
          }
          if (header.unit === 'irsdk_PitSvFlags') {
            const PitServiceFlagsBitField = new BitField(PitServiceFlags);
            console.log(header.name, header.type, PitServiceFlagsBitField.toObject(+sampleValue.toString(16)));
          }
        }

        if (header.type === 4) {
          // float
          const sampleValue = getValue(sampleBuffer, header.offset, 'float');
          console.log(header.name, header.type, sampleValue.toPrecision(4));
        }

        if (header.type === 5) {
          // double
          const sampleValue = getValue(sampleBuffer, header.offset, 'double');
          console.log(header.name, header.type, sampleValue.toPrecision(4));
        }
      });

      sample++;
    } catch (err) {
      endOfSamplesReached = true;
    }
  }

  //   console.log(diskSubHeader);
  //   console.log(header);
  //   console.log(varHeader);
  //   console.log(sessionInfoBuffer.toString("ascii"));
}

main();

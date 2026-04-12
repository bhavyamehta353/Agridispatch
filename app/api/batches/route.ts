import base from '../../lib/airtable';
import { NextResponse } from 'next/server';

export async function GET() {
  const records = await base('Farmer_Batches').select().all();
  
  const batches = records.map(record => ({
    id: record.id,
    batchId: record.get('batch_id'),
    originName: record.get('origin_name'),
    originLat: record.get('origin_lat'),
    originLng: record.get('origin_lng'),
    harvestTime: record.get('harvest_time'),
    weightKg: record.get('weight_harvest_kg'),
    qualityInitial: record.get('quality_initial'),
    maturityGrade: record.get('maturity_grade'),
  }));
  
  return NextResponse.json(batches);
}
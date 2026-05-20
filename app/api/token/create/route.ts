import { createClient } from '@/lib/supabase/client';
import { TokenDTO } from '@/components/tokens/launch/types';


export const dynamic = 'force-dynamic';


const supabase = createClient();

//TEST
const n8n_endpoint= "http://n8n.abundancedigitalmedia.com:5678/webhook-test/d561cf1b-27ba-4f65-ad21-77df991648ee"

//PRODUCTION
//const n8n_endpoint = "http://n8n.abundancedigitalmedia.com:5678/webhook/d561cf1b-27ba-4f65-ad21-77df991648ee"


export async function POST(request: Request) {
    const body = await request.json();

    try {
        const uploadResponse = uploadTokenMeta(body.token);
    } catch (error) {
        return new Response(), {
            headers: { 'Content-Type': 'application/json' },
            status: 00,
        });
    }



}


async function uploadTokenMeta(token: {}) {
    const response = await fetch(n8n_endpoint, {
        method: 'PUT',
        headers: {
        'Content-Type': 'application/json',
        // 'Authorization': `Bearer ${process.env.API_TOKEN}`, // Securely use env vars
        },
        body: JSON.stringify(token),
    });

    if (!response.ok) throw new Error('Failed to update');
    return response.json();
}

import { createClient } from '@/lib/supabase/client';
import { TokenDTO } from '@/components/tokens/launch/types';


export const dynamic = 'force-dynamic';


const supabase = createClient();

//TEST
const N8N_WEBHOOK = "http://n8n.abundancedigitalmedia.com:5678/webhook-test/d561cf1b-27ba-4f65-ad21-77df991648ee"

//PRODUCTION
//const N8N_WEBHOOK = "http://n8n.abundancedigitalmedia.com:5678/webhook/d561cf1b-27ba-4f65-ad21-77df991648ee "

const AWS_CREDENTIALS  ='';
const AWS_ENDPOINT = '';

export async function POST(request: Request) {
    const body = await request.json();

    try {
        const uploadTokenMetaResponse = uploadTokenMeta(body.token);
        const uploadTokenIMageREsponse = 
    } catch (error) {
        return new Response(), {
            headers: { 'Content-Type': 'application/json' },
            status: 00,
        });
    }



}


async function uploadTokenMeta(token: {}) {
    const response = await fetch(N8N_WEBHOOK, {
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

async function uploadTokenImage() {
    const response = await fetch(AWS_ENDPOINT, {
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

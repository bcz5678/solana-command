import { createClient } from '@/lib/supabase/client';
import { requireSuperAdmin } from '@/app/api/require-super-admin';
import { TokenDTO } from '@/components/tokens/launch/types';
import { SupabaseClient } from '@supabase/supabase-js';


export const dynamic = 'force-dynamic';


//TEST
const N8N_WEBHOOK = "http://n8n.abundancedigitalmedia.com:5678/webhook-test/d561cf1b-27ba-4f65-ad21-77df991648ee"

//PRODUCTION
//const N8N_WEBHOOK = "http://n8n.abundancedigitalmedia.com:5678/webhook/d561cf1b-27ba-4f65-ad21-77df991648ee "

const AWS_CREDENTIALS  ='';
const AWS_ENDPOINT = '';

export async function POST(request: Request): Promise<Response> {
    let admin, userId
    try {
        ({ admin, userId } = await requireSuperAdmin())
    } catch (e) {
        return e as Response   // the 401 or 403
    }



    const body = await request.json();

    

    try {
        const uploadTokenMetaResponse = uploadTokenMeta(body.token);
        const uploadTokenIMageREsponse = uploadTokenImage(body.token);


        return new Response(JSON.stringify({message: "success", token_meta_url: uploadTokenMetaResponse}),
            {
                headers: { 'Content-Type': 'application/json' },
                status: 200,
            }  
        );
    } catch (error) {
       return new Response(JSON.stringify({message: "failed"}),
            {
                headers: { 'Content-Type': 'application/json' },
                status: 200,
            }  
        );
    }
}


async function uploadTokenMeta(token: {}) {
    const response = await fetch(N8N_WEBHOOK, {
        method: 'POST',
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
        method: 'POST',
        headers: {
        'Content-Type': 'application/json',
        // 'Authorization': `Bearer ${process.env.API_TOKEN}`, // Securely use env vars
        },
        body: JSON.stringify(token),
    });

    if (!response.ok) throw new Error('Failed to update');
    return response.json();
}

import { S3Client, PutObjectCommand, S3ServiceException } from '@aws-sdk/client-s3'

export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<Response> {
    const formData = await request.formData()
    const image = formData.get('image') as File | null

    if (!image) {
        return Response.json({ error: 'No image provided' }, { status: 400 })
    }

    const s3Client = new S3Client({
        region: process.env.AWS_S3_REGION,
        credentials: {
            accessKeyId: process.env.AWS_S3_ACCESS_KEY!,
            secretAccessKey: process.env.AWS_S3_SECRET_ACCESS_KEY!,
        },
    })

    try {
        await s3Client.send(new PutObjectCommand({
            Bucket: process.env.AWS_S3_TOKEN_BUCKET_NAME,
            Key: image.name,
            ContentType: image.type,
            Body: Buffer.from(await image.arrayBuffer()),
        }))

        const url = `https://${process.env.AWS_S3_TOKEN_BUCKET_NAME}.s3.${process.env.AWS_S3_REGION}.amazonaws.com/${image.name}`
        return Response.json({ url }, { status: 200 })

    } catch (caught) {
        if (caught instanceof S3ServiceException && caught.name === 'EntityTooLarge') {
            return Response.json({ error: 'File too large for direct upload.' }, { status: 413 })
        } else if (caught instanceof S3ServiceException) {
            return Response.json({ error: `S3 error: ${caught.name}: ${caught.message}` }, { status: 500 })
        }
        throw caught
    }
}

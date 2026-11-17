import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

/**
 * Dónde vive el archivo del índice. Una interfaz mínima para poder probar la
 * reconstrucción sin S3, y una escritura condicional para que dos
 * reconstrucciones simultáneas (la programada y una manual) no se pisen.
 */
export interface AlmacenIndice {
  leer(): Promise<{ contenido: Buffer; version: string } | null>;
  /** `versionPrevia` es la que devolvió `leer` (o `null` si el archivo no existía). */
  escribir(contenido: Buffer, versionPrevia: string | null): Promise<'ok' | 'conflicto'>;
}

export const CLAVE_INDICE = 'indice/v1/indice.bin';

let cliente: S3Client | undefined;

function estadoHttp(error: unknown): number | undefined {
  return (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
}

export function crearAlmacenS3(bucket: string, clave: string = CLAVE_INDICE): AlmacenIndice {
  cliente ??= new S3Client({});
  const s3 = cliente;
  return {
    async leer() {
      try {
        const respuesta = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: clave }));
        const bytes = await respuesta.Body?.transformToByteArray();
        if (!bytes || !respuesta.ETag) {
          return null;
        }
        return { contenido: Buffer.from(bytes), version: respuesta.ETag };
      } catch (error) {
        if ((error as { name?: string }).name === 'NoSuchKey' || estadoHttp(error) === 404) {
          return null;
        }
        throw error;
      }
    },
    async escribir(contenido, versionPrevia) {
      try {
        await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: clave,
            Body: contenido,
            ContentType: 'application/octet-stream',
            ServerSideEncryption: 'AES256',
            // Condicional: si alguien escribió entre nuestra lectura y esta escritura, S3 la rechaza con 412 (o 409 si hay otra en vuelo).
            ...(versionPrevia ? { IfMatch: versionPrevia } : { IfNoneMatch: '*' }),
          }),
        );
        return 'ok';
      } catch (error) {
        const estado = estadoHttp(error);
        if (estado === 412 || estado === 409) {
          return 'conflicto';
        }
        throw error;
      }
    },
  };
}

import VanityAddressImportForm from '@/components/tokens/vanity-address-import/vanity-address-import-form';

export default function Page() {
    return (
        <div className="flex-1 w-full flex flex-col gap-6 p-4">
            <h1 className="text-2xl font-bold text-black">Vanity Address Creator (Pump.fun)</h1>
            <VanityAddressImportForm />
        </div>
    );
}
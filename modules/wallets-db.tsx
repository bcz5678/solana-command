import { OwnerDTO, WalletTypeDTO, WalletGroupDTO } from "@/app/db/models/wallet"; 
import { createClient } from '@/lib/supabase/client';
import { SupabaseClient } from "@supabase/supabase-js";





export const getOwners =  async (supabase: SupabaseClient): Promise<OwnerDTO[]>  => {
    let returnList: OwnerDTO[] = [];
    const { data: owners, error } = await supabase
        .from('owners')
        .select('*')

    if (error) {
        console.error(`getOwners error:`, error);
        return returnList;
    }

    if(owners != null) {
        owners.forEach(element => {
                let tempOwner: OwnerDTO = {
                id: element.id,
                name: element.name,
                }
                returnList.push(tempOwner);
        });
    }

    return returnList;
}

export const getWalletTypes = async (supabase: SupabaseClient): Promise<WalletTypeDTO[]> => {
    let returnList: WalletTypeDTO[] = [];
    const { data: wallet_type, error } = await supabase
        .from('wallet_type')
        .select('*')

    if(wallet_type != null) {
        wallet_type.forEach(element => {
            let tempWalletType: WalletTypeDTO = {
                id: element.id,
                name: element.name,
            }
            returnList.push(tempWalletType);
        });

    }
    return returnList;
}
export const getWalletGroups = async (supabase: SupabaseClient): Promise<WalletGroupDTO[]> => {
    let returnList: WalletGroupDTO[] = [];
    const { data: wallet_groups, error } = await supabase
        .from('wallet_groups')
        .select('*');

    if(wallet_groups != null) {
        wallet_groups.forEach(element => {
            let tempWalletGroup: WalletGroupDTO = {
                id: element.id,
                name: element.name,
                owner_id: element.owner_id
            }
            returnList.push(tempWalletGroup);
        });
    }
    return returnList;
}
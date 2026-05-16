'use client'

import { useState } from 'react';
import { WalletIcon, CoinsIcon, ChartColumnDecreasingIcon} from 'lucide-react';
import { LaunchType } from '@/components/tokens/launch/types';
import {LaunchConfig } from './launch-config-class';

import { lamportsBNToSolDisplay } from '@/lib/lamports';

type Props = {
    launchConfig: LaunchConfig
}


export default function LaunchCurrentConfiguration({launchConfig }: Props) {

    return (
        <div className="bg-black rounded-2xl flex flex-col p-3">
            <h1 className="text-white text-1xl">Current Configuration | {launchConfig.launchType.toString()} Launch</h1>
            <div className="flex flex-row gap-4">
                <div className="flex flex-1">
                    <div className="flex flex-col w-full items-center" id="walletsDisplay">
                        <div className="border-2 border-dashed border-white rounded-xl w-full p-5 ">
                            <div className="flex flex-row">
                                <div className="flex-1 flex-col items-center">
                                    <div className="flex text-white text-center items-center justify-center">
                                        {launchConfig.walletTrades.length} Wallets    
                                    </div>
                                    <div className="flex items-center justify-center">
                                        <WalletIcon className="text-white"/>
                                    </div>
                                </div>
                                <div className="flex-1 flex-col">
                                    <div className="flex text-white text-center justify-center">
                                        {lamportsBNToSolDisplay(launchConfig.totalSOLInLamports)} Sol    
                                    </div>
                                    <div className="flex  text-center justify-center">
                                        <CoinsIcon className="text-white justify-center"/>
                                    </div>
                                    
                                </div>
                            </div>
                        </div>
                        <div className="text-white justify-center">
                            Total   
                        </div>                    
                    
                    </div>
                </div>
                <div className="flex flex-2">
                    <div className="flex flex-col w-full items-center" id="strategyDisplay">
                        <div className="border-2 border-dashed border-white rounded-xl w-full p-5 ">
                            <div className="flex flex-row">
                                <div className="flex-1 flex-col items-center">
                                    <div className="flex text-white text-center items-center justify-center">
                                        {launchConfig.tokensTotal.toString()} {launchConfig.launchType}
                                    </div>
                                    <div className="flex items-center justify-center">
                                        <ChartColumnDecreasingIcon className="text-white"/>
                                    </div>
                                </div>
                                 <div className="flex-1 flex-col items-center">
                                    <div className="flex text-white text-center items-center justify-center">
                                        {launchConfig.percentOfSupply.toString()}%   
                                    </div>
                                    <div className="flex text-white items-center justify-center">
                                        of the Total Supply
                                    </div>
                                </div>
                                <div className="flex-1 flex-col">
                                    <div className="flex text-white text-center justify-center">
                                        ${launchConfig.marketCap.toString()}    
                                    </div>
                                    <div className="flex text-white text-center justify-center">
                                        MC
                                    </div>
                                    
                                </div>
                            </div>
                        </div>
                        <div className="text-white justify-center">
                            {launchConfig.launchType} Launch
                        </div>                    
                    </div>
                 </div>
            </div>
        </div>
    );

}
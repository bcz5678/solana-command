

import { useState } from 'react';

export default function LaunchBasic() {
    const [tokenSelected, setTokenSelected] = useState<string | null>(null);

    return (   
        <div>  
            <h1 className="text-2xl">Launch Basic</h1>
        </div>  
    );
}